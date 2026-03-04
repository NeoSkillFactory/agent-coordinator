'use strict';

/**
 * workflow-manager.js
 *
 * Manages multi-agent workflows with dependency tracking and task sequencing.
 * Builds task dependency trees, determines optimal execution order via
 * topological sort, and tracks per-task and per-workflow state.
 */

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const WORKFLOW_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
};

const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

class WorkflowManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    super();
    this.verbose = options.verbose ?? false;
    this.workflows = new Map();
  }

  // ---------------------------------------------------------------------------
  // Workflow CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new workflow definition.
   * @param {object} definition
   * @param {string} definition.name
   * @param {object[]} definition.tasks
   * @returns {object} Workflow object
   */
  createWorkflow(definition) {
    if (!definition.name) throw new Error('Workflow must have a name');
    if (!Array.isArray(definition.tasks) || definition.tasks.length === 0) {
      throw new Error('Workflow must have at least one task');
    }

    const workflowId = randomUUID();
    const tasks = {};

    for (const taskDef of definition.tasks) {
      if (!taskDef.id) throw new Error('Each task must have an id');
      if (!taskDef.assignTo) throw new Error(`Task ${taskDef.id} must have an assignTo field`);

      tasks[taskDef.id] = {
        id: taskDef.id,
        description: taskDef.description || '',
        assignTo: taskDef.assignTo,
        dependencies: taskDef.dependencies || [],
        status: TASK_STATUS.PENDING,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
      };
    }

    const workflow = {
      id: workflowId,
      name: definition.name,
      status: WORKFLOW_STATUS.PENDING,
      tasks,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
    };

    this.workflows.set(workflowId, workflow);
    this._log(`Created workflow: ${definition.name} (${workflowId})`);
    this.emit('workflow:created', { id: workflowId, name: definition.name });
    return workflow;
  }

  /**
   * List all workflows.
   * @returns {object[]}
   */
  listWorkflows() {
    return Array.from(this.workflows.values()).map((wf) => this._summariseWorkflow(wf));
  }

  /**
   * Get a workflow by ID.
   * @param {string} workflowId
   * @returns {object}
   */
  getWorkflow(workflowId) {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`Workflow not found: ${workflowId}`);
    return wf;
  }

  /**
   * Get a task within a workflow.
   * @param {string} workflowId
   * @param {string} taskId
   * @returns {object}
   */
  getTask(workflowId, taskId) {
    const wf = this.getWorkflow(workflowId);
    if (!wf.tasks[taskId]) throw new Error(`Task not found: ${taskId} in workflow ${workflowId}`);
    return wf.tasks[taskId];
  }

  // ---------------------------------------------------------------------------
  // Workflow Lifecycle
  // ---------------------------------------------------------------------------

  startWorkflow(workflowId) {
    const wf = this.getWorkflow(workflowId);
    wf.status = WORKFLOW_STATUS.RUNNING;
    wf.startedAt = Date.now();
    this.emit('workflow:started', { id: workflowId });
  }

  completeWorkflow(workflowId) {
    const wf = this.getWorkflow(workflowId);
    wf.status = WORKFLOW_STATUS.COMPLETED;
    wf.completedAt = Date.now();
    this.emit('workflow:completed', { id: workflowId });
  }

  failWorkflow(workflowId, reason) {
    const wf = this.getWorkflow(workflowId);
    wf.status = WORKFLOW_STATUS.FAILED;
    wf.error = reason;
    wf.completedAt = Date.now();
    this.emit('workflow:failed', { id: workflowId, reason });
  }

  stopWorkflow(workflowId) {
    const wf = this.getWorkflow(workflowId);
    wf.status = WORKFLOW_STATUS.STOPPED;
    wf.completedAt = Date.now();
    this.emit('workflow:stopped', { id: workflowId });
  }

  // ---------------------------------------------------------------------------
  // Task Lifecycle
  // ---------------------------------------------------------------------------

  startTask(workflowId, taskId) {
    const task = this.getTask(workflowId, taskId);
    task.status = TASK_STATUS.RUNNING;
    task.startedAt = Date.now();
  }

  completeTask(workflowId, taskId, result) {
    const task = this.getTask(workflowId, taskId);
    task.status = TASK_STATUS.COMPLETED;
    task.result = result;
    task.completedAt = Date.now();
  }

  failTask(workflowId, taskId, error) {
    const task = this.getTask(workflowId, taskId);
    task.status = TASK_STATUS.FAILED;
    task.error = error;
    task.completedAt = Date.now();
  }

  skipTask(workflowId, taskId) {
    const task = this.getTask(workflowId, taskId);
    task.status = TASK_STATUS.SKIPPED;
    task.completedAt = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Dependency Resolution
  // ---------------------------------------------------------------------------

  /**
   * Compute the topological execution order for all tasks in the workflow.
   * Throws if a circular dependency is detected.
   * @param {string} workflowId
   * @returns {string[]} Ordered list of task IDs
   */
  getExecutionOrder(workflowId) {
    const wf = this.getWorkflow(workflowId);
    const tasks = wf.tasks;
    const ids = Object.keys(tasks);

    // Validate that all dependency references exist
    for (const id of ids) {
      for (const dep of tasks[id].dependencies) {
        if (!tasks[dep]) {
          throw new Error(`Task ${id} depends on unknown task: ${dep}`);
        }
      }
    }

    // Kahn's algorithm for topological sort
    const inDegree = {};
    const adjacency = {};

    for (const id of ids) {
      inDegree[id] = 0;
      adjacency[id] = [];
    }

    for (const id of ids) {
      for (const dep of tasks[id].dependencies) {
        adjacency[dep].push(id);
        inDegree[id]++;
      }
    }

    const queue = ids.filter((id) => inDegree[id] === 0);
    const order = [];

    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);

      for (const neighbor of adjacency[current]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (order.length !== ids.length) {
      const remaining = ids.filter((id) => !order.includes(id));
      throw new Error(`Circular dependency detected in task graph involving: ${remaining.join(', ')}`);
    }

    this._log(`Execution order for ${workflowId}: ${order.join(' -> ')}`);
    return order;
  }

  /**
   * Build a dependency tree for display/debugging.
   * @param {string} workflowId
   * @returns {object} { taskId: { dependsOn: string[], requiredBy: string[] } }
   */
  getDependencyTree(workflowId) {
    const wf = this.getWorkflow(workflowId);
    const tree = {};

    for (const [id, task] of Object.entries(wf.tasks)) {
      tree[id] = {
        dependsOn: [...task.dependencies],
        requiredBy: [],
      };
    }

    for (const [id, task] of Object.entries(wf.tasks)) {
      for (const dep of task.dependencies) {
        if (tree[dep]) {
          tree[dep].requiredBy.push(id);
        }
      }
    }

    return tree;
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /**
   * Generate a status summary for a workflow.
   * @param {string} workflowId
   * @returns {object}
   */
  getStatus(workflowId) {
    const wf = this.getWorkflow(workflowId);
    return this._summariseWorkflow(wf);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _summariseWorkflow(wf) {
    const tasks = Object.values(wf.tasks);
    const taskSummary = tasks.map((t) => ({
      id: t.id,
      description: t.description,
      assignTo: t.assignTo,
      status: t.status,
      dependencies: t.dependencies,
      durationMs: t.startedAt && t.completedAt ? t.completedAt - t.startedAt : null,
    }));

    return {
      id: wf.id,
      name: wf.name,
      status: wf.status,
      error: wf.error,
      tasks: taskSummary,
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t) => t.status === TASK_STATUS.COMPLETED).length,
      failedTasks: tasks.filter((t) => t.status === TASK_STATUS.FAILED).length,
      pendingTasks: tasks.filter((t) => t.status === TASK_STATUS.PENDING).length,
      createdAt: wf.createdAt,
      startedAt: wf.startedAt,
      completedAt: wf.completedAt,
      durationMs: wf.startedAt && wf.completedAt ? wf.completedAt - wf.startedAt : null,
    };
  }

  _log(msg) {
    if (this.verbose) {
      console.error(`[workflow-manager] ${msg}`);
    }
  }
}

module.exports = { WorkflowManager, WORKFLOW_STATUS, TASK_STATUS };
