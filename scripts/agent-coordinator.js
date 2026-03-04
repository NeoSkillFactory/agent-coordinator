'use strict';

/**
 * agent-coordinator.js
 *
 * Main coordination engine for multi-agent workflows.
 * Manages task mapping, message queues, retry logic, and workflow analytics.
 */

const { EventEmitter } = require('events');
const { AgentRouter } = require('./agent-router');
const { WorkflowManager } = require('./workflow-manager');

class AgentCoordinator extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} [options.maxRetries=3] - Max retry attempts per task
   * @param {number} [options.timeoutMs=30000] - Task timeout in milliseconds
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor(options = {}) {
    super();
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.verbose = options.verbose ?? false;

    this.agents = new Map();
    this.router = new AgentRouter({ verbose: this.verbose });
    this.workflowManager = new WorkflowManager({ verbose: this.verbose });

    this._setupRouterEvents();
    this._setupWorkflowEvents();
  }

  // ---------------------------------------------------------------------------
  // Agent Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an agent with the coordinator.
   * @param {object} agent
   * @param {string} agent.id - Unique agent identifier
   * @param {string} agent.role - Agent role (e.g. 'analyst', 'executor')
   * @param {string[]} [agent.capabilities=[]] - List of capability strings
   */
  registerAgent(agent) {
    if (!agent.id || !agent.role) {
      throw new Error('Agent must have id and role');
    }
    const entry = {
      id: agent.id,
      role: agent.role,
      capabilities: agent.capabilities || [],
      status: 'idle',
      tasksCompleted: 0,
      tasksFailed: 0,
      registeredAt: Date.now(),
    };
    this.agents.set(agent.id, entry);
    this.router.registerSession(agent.id);
    this._log(`Registered agent: ${agent.id} (${agent.role})`);
    this.emit('agent:registered', entry);
    return entry;
  }

  /**
   * Unregister an agent.
   * @param {string} agentId
   */
  unregisterAgent(agentId) {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.agents.delete(agentId);
    this.router.removeSession(agentId);
    this._log(`Unregistered agent: ${agentId}`);
    this.emit('agent:unregistered', { agentId });
  }

  /**
   * Return a list of all registered agents.
   * @returns {object[]}
   */
  listAgents() {
    return Array.from(this.agents.values());
  }

  // ---------------------------------------------------------------------------
  // Workflow Creation
  // ---------------------------------------------------------------------------

  /**
   * Create a new workflow definition.
   * @param {object} definition
   * @param {string} definition.name - Workflow name
   * @param {object[]} definition.tasks - Task list
   * @returns {object} Workflow object
   */
  createWorkflow(definition) {
    return this.workflowManager.createWorkflow(definition);
  }

  /**
   * List all workflows tracked by the workflow manager.
   * @returns {object[]}
   */
  listWorkflows() {
    return this.workflowManager.listWorkflows();
  }

  /**
   * Get a workflow by ID.
   * @param {string} workflowId
   * @returns {object}
   */
  getWorkflow(workflowId) {
    return this.workflowManager.getWorkflow(workflowId);
  }

  // ---------------------------------------------------------------------------
  // Workflow Execution
  // ---------------------------------------------------------------------------

  /**
   * Run a workflow end-to-end.
   * Returns a result object with status, completedTasks, failedTasks, and summary.
   * @param {string} workflowId
   * @returns {Promise<object>}
   */
  async runWorkflow(workflowId) {
    const workflow = this.workflowManager.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    this._log(`Starting workflow: ${workflow.name} (${workflowId})`);
    this.workflowManager.startWorkflow(workflowId);
    this.emit('workflow:started', { workflowId, name: workflow.name });

    const startTime = Date.now();
    const completedTasks = [];
    const failedTasks = [];

    try {
      let executionOrder;
      try {
        executionOrder = this.workflowManager.getExecutionOrder(workflowId);
      } catch (err) {
        this.workflowManager.failWorkflow(workflowId, err.message);
        this.emit('workflow:failed', { workflowId, error: err.message });
        throw err;
      }

      for (const taskId of executionOrder) {
        const task = this.workflowManager.getTask(workflowId, taskId);

        // Validate agent assignment
        if (!this.agents.has(task.assignTo)) {
          const errMsg = `Task ${taskId} assigned to unknown agent: ${task.assignTo}`;
          this._log(`ERROR: ${errMsg}`);
          this.workflowManager.failTask(workflowId, taskId, errMsg);
          failedTasks.push({ taskId, error: errMsg });
          this.emit('task:failed', { workflowId, taskId, error: errMsg });
          throw new Error(errMsg);
        }

        // Execute with retries
        let succeeded = false;
        let lastError = null;
        const agent = this.agents.get(task.assignTo);

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
          this._log(`Executing task ${taskId} via ${task.assignTo} (attempt ${attempt}/${this.maxRetries})`);
          this.workflowManager.startTask(workflowId, taskId);
          agent.status = 'busy';
          this.emit('task:started', { workflowId, taskId, agentId: task.assignTo, attempt });

          try {
            const result = await this._executeTask(task, agent);
            this.workflowManager.completeTask(workflowId, taskId, result);
            agent.status = 'idle';
            agent.tasksCompleted++;
            completedTasks.push({ taskId, agentId: task.assignTo, result });
            this.emit('task:completed', { workflowId, taskId, agentId: task.assignTo, result });
            succeeded = true;
            break;
          } catch (err) {
            lastError = err.message;
            agent.status = 'idle';
            agent.tasksFailed++;
            this._log(`Task ${taskId} failed on attempt ${attempt}: ${lastError}`);
            this.emit('task:retry', { workflowId, taskId, attempt, error: lastError });

            if (attempt < this.maxRetries) {
              await this._delay(500 * attempt);
            }
          }
        }

        if (!succeeded) {
          this.workflowManager.failTask(workflowId, taskId, lastError);
          failedTasks.push({ taskId, error: lastError });
          this.emit('task:failed', { workflowId, taskId, error: lastError });
          this.workflowManager.failWorkflow(workflowId, `Task ${taskId} failed: ${lastError}`);
          this.emit('workflow:failed', { workflowId, error: `Task ${taskId} failed after ${this.maxRetries} attempts` });
          throw new Error(`Task ${taskId} failed after ${this.maxRetries} attempts: ${lastError}`);
        }
      }

      const durationMs = Date.now() - startTime;
      this.workflowManager.completeWorkflow(workflowId);

      const metrics = this._buildMetrics(workflow, completedTasks, failedTasks, durationMs);
      this.emit('workflow:completed', { workflowId, metrics });
      this._log(`Workflow ${workflow.name} completed in ${durationMs}ms`);

      return {
        status: 'completed',
        workflowId,
        completedTasks,
        failedTasks,
        durationMs,
        summary: metrics.summary,
        metrics,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      return {
        status: 'failed',
        workflowId,
        completedTasks,
        failedTasks,
        durationMs,
        error: err.message,
        summary: `Workflow failed after ${durationMs}ms: ${err.message}`,
      };
    }
  }

  /**
   * Stop a running workflow by ID (marks it as stopped).
   * @param {string} workflowId
   */
  stopWorkflow(workflowId) {
    this.workflowManager.stopWorkflow(workflowId);
    this.emit('workflow:stopped', { workflowId });
    this._log(`Workflow stopped: ${workflowId}`);
  }

  // ---------------------------------------------------------------------------
  // Task Delegation
  // ---------------------------------------------------------------------------

  /**
   * Delegate a standalone task to a list of agents.
   * Returns results from all agents that accepted the task.
   * @param {object} task
   * @param {string} task.description - Task description
   * @param {string[]} agentIds - Agent IDs to delegate to
   * @returns {Promise<object[]>}
   */
  async delegateTask(task, agentIds) {
    const results = [];
    for (const agentId of agentIds) {
      if (!this.agents.has(agentId)) {
        results.push({ agentId, error: `Agent not found: ${agentId}` });
        continue;
      }
      const agent = this.agents.get(agentId);
      try {
        const result = await this._executeTask(
          { id: `delegated-${Date.now()}`, ...task },
          agent
        );
        results.push({ agentId, result });
      } catch (err) {
        results.push({ agentId, error: err.message });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute a single task via the agent router.
   * Simulates agent execution with a timeout guard.
   * @param {object} task
   * @param {object} agent
   * @returns {Promise<object>}
   */
  async _executeTask(task, agent) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agent.id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.router.routeMessage(
        { from: 'coordinator', to: agent.id, task },
        (err, result) => {
          clearTimeout(timer);
          if (err) return reject(err);
          resolve(result);
        }
      );
    });
  }

  _buildMetrics(workflow, completed, failed, durationMs) {
    const totalTasks = Object.keys(workflow.tasks).length;
    const successRate = totalTasks > 0 ? ((completed.length / totalTasks) * 100).toFixed(1) : '0.0';
    const summary =
      `Workflow "${workflow.name}": ${completed.length}/${totalTasks} tasks completed ` +
      `(${successRate}% success rate) in ${durationMs}ms`;

    const agentStats = {};
    for (const { agentId } of completed) {
      agentStats[agentId] = agentStats[agentId] || { completed: 0 };
      agentStats[agentId].completed++;
    }

    return {
      summary,
      totalTasks,
      completedTasks: completed.length,
      failedTasks: failed.length,
      successRate: parseFloat(successRate),
      durationMs,
      agentStats,
    };
  }

  _setupRouterEvents() {
    this.router.on('message:routed', (data) => {
      this._log(`Message routed: ${data.from} -> ${data.to}`);
    });
    this.router.on('message:error', (data) => {
      this._log(`Routing error: ${data.error}`);
    });
  }

  _setupWorkflowEvents() {
    this.workflowManager.on('workflow:created', (data) => {
      this._log(`Workflow created: ${data.name} (${data.id})`);
    });
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _log(msg) {
    if (this.verbose) {
      console.error(`[coordinator] ${msg}`);
    }
  }
}

module.exports = { AgentCoordinator };
