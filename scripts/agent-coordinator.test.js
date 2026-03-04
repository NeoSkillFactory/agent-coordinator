'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { AgentCoordinator } = require('./agent-coordinator');
const { WorkflowManager, WORKFLOW_STATUS, TASK_STATUS } = require('./workflow-manager');
const { AgentRouter } = require('./agent-router');

// ---------------------------------------------------------------------------
// WorkflowManager tests
// ---------------------------------------------------------------------------

describe('WorkflowManager', () => {
  it('creates a workflow with tasks', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'test-wf',
      tasks: [
        { id: 't1', description: 'First task', assignTo: 'agent-a', dependencies: [] },
        { id: 't2', description: 'Second task', assignTo: 'agent-b', dependencies: ['t1'] },
      ],
    });
    assert.ok(wf.id, 'workflow should have an id');
    assert.equal(wf.name, 'test-wf');
    assert.equal(wf.status, WORKFLOW_STATUS.PENDING);
    assert.ok(wf.tasks['t1'], 'task t1 should exist');
    assert.ok(wf.tasks['t2'], 'task t2 should exist');
  });

  it('throws if workflow has no tasks', () => {
    const wm = new WorkflowManager();
    assert.throws(
      () => wm.createWorkflow({ name: 'empty', tasks: [] }),
      /at least one task/
    );
  });

  it('throws if task is missing assignTo', () => {
    const wm = new WorkflowManager();
    assert.throws(
      () => wm.createWorkflow({ name: 'bad', tasks: [{ id: 't1', description: 'x' }] }),
      /assignTo/
    );
  });

  it('returns correct topological order for a chain', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'chain',
      tasks: [
        { id: 'a', assignTo: 'x', dependencies: [] },
        { id: 'b', assignTo: 'x', dependencies: ['a'] },
        { id: 'c', assignTo: 'x', dependencies: ['b'] },
      ],
    });
    const order = wm.getExecutionOrder(wf.id);
    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  it('detects circular dependencies', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'circular',
      tasks: [
        { id: 'a', assignTo: 'x', dependencies: ['b'] },
        { id: 'b', assignTo: 'x', dependencies: ['a'] },
      ],
    });
    assert.throws(() => wm.getExecutionOrder(wf.id), /Circular dependency/);
  });

  it('detects unknown dependency references', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'bad-dep',
      tasks: [
        { id: 'a', assignTo: 'x', dependencies: ['nonexistent'] },
      ],
    });
    assert.throws(() => wm.getExecutionOrder(wf.id), /unknown task/);
  });

  it('updates task and workflow lifecycle correctly', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'lifecycle',
      tasks: [{ id: 't1', assignTo: 'x', dependencies: [] }],
    });
    wm.startWorkflow(wf.id);
    assert.equal(wm.getWorkflow(wf.id).status, WORKFLOW_STATUS.RUNNING);

    wm.startTask(wf.id, 't1');
    assert.equal(wm.getTask(wf.id, 't1').status, TASK_STATUS.RUNNING);

    wm.completeTask(wf.id, 't1', { output: 'done' });
    assert.equal(wm.getTask(wf.id, 't1').status, TASK_STATUS.COMPLETED);

    wm.completeWorkflow(wf.id);
    assert.equal(wm.getWorkflow(wf.id).status, WORKFLOW_STATUS.COMPLETED);
  });

  it('builds correct dependency tree', () => {
    const wm = new WorkflowManager();
    const wf = wm.createWorkflow({
      name: 'tree',
      tasks: [
        { id: 'root', assignTo: 'x', dependencies: [] },
        { id: 'child', assignTo: 'x', dependencies: ['root'] },
      ],
    });
    const tree = wm.getDependencyTree(wf.id);
    assert.deepEqual(tree['root'].dependsOn, []);
    assert.deepEqual(tree['root'].requiredBy, ['child']);
    assert.deepEqual(tree['child'].dependsOn, ['root']);
    assert.deepEqual(tree['child'].requiredBy, []);
  });
});

// ---------------------------------------------------------------------------
// AgentRouter tests
// ---------------------------------------------------------------------------

describe('AgentRouter', () => {
  it('registers and removes sessions', () => {
    const router = new AgentRouter();
    router.registerSession('a1');
    assert.ok(router.hasSession('a1'));
    router.removeSession('a1');
    assert.ok(!router.hasSession('a1'));
  });

  it('routes a message and returns a result', (_, done) => {
    const router = new AgentRouter();
    router.registerSession('target');
    router.routeMessage({ from: 'coordinator', to: 'target', task: { id: 't1', description: 'do work' } }, (err, result) => {
      assert.ifError(err);
      assert.equal(result.agentId, 'target');
      assert.equal(result.status, 'success');
      done();
    });
  });

  it('returns error when routing to unknown session', (_, done) => {
    const router = new AgentRouter();
    router.routeMessage({ from: 'coord', to: 'ghost', task: { id: 't2', description: 'x' } }, (err) => {
      assert.ok(err, 'should return an error');
      assert.match(err.message, /session not found/);
      done();
    });
  });

  it('applies middleware in order', (_, done) => {
    const router = new AgentRouter();
    router.registerSession('b1');
    const log = [];
    router.use((msg, next) => { log.push('mw1'); next(null, msg); });
    router.use((msg, next) => { log.push('mw2'); next(null, msg); });

    router.routeMessage({ from: 'coord', to: 'b1', task: { id: 't3', description: 'y' } }, (err) => {
      assert.ifError(err);
      assert.deepEqual(log, ['mw1', 'mw2']);
      done();
    });
  });

  it('broadcasts to all sessions except sender', async () => {
    const router = new AgentRouter();
    router.registerSession('sender');
    router.registerSession('receiver-1');
    router.registerSession('receiver-2');

    const results = await router.broadcast('sender', { id: 'bcast', description: 'hello' });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.error === null));
  });

  it('returns inbox messages', (_, done) => {
    const router = new AgentRouter();
    router.registerSession('c1');
    router.routeMessage({ from: 'coord', to: 'c1', task: { id: 't5', description: 'z' } }, () => {
      const inbox = router.getInbox('c1');
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0].to, 'c1');
      done();
    });
  });
});

// ---------------------------------------------------------------------------
// AgentCoordinator integration tests
// ---------------------------------------------------------------------------

describe('AgentCoordinator', () => {
  it('registers agents and lists them', () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'a', role: 'analyst' });
    coord.registerAgent({ id: 'b', role: 'executor' });
    const agents = coord.listAgents();
    assert.equal(agents.length, 2);
    assert.ok(agents.find((a) => a.id === 'a'));
  });

  it('throws when registering agent without id/role', () => {
    const coord = new AgentCoordinator();
    assert.throws(() => coord.registerAgent({ id: 'x' }), /role/);
    assert.throws(() => coord.registerAgent({ role: 'analyst' }), /id/);
  });

  it('runs a linear workflow to completion', async () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'a1', role: 'analyst' });
    coord.registerAgent({ id: 'a2', role: 'executor' });

    const wf = coord.createWorkflow({
      name: 'linear-test',
      tasks: [
        { id: 't1', description: 'Step 1', assignTo: 'a1', dependencies: [] },
        { id: 't2', description: 'Step 2', assignTo: 'a2', dependencies: ['t1'] },
      ],
    });

    const result = await coord.runWorkflow(wf.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.completedTasks.length, 2);
    assert.equal(result.failedTasks.length, 0);
  });

  it('fails workflow when agent is not registered', async () => {
    const coord = new AgentCoordinator({ maxRetries: 1 });
    coord.registerAgent({ id: 'known', role: 'analyst' });

    const wf = coord.createWorkflow({
      name: 'fail-test',
      tasks: [
        { id: 't1', description: 'Task', assignTo: 'unknown-agent', dependencies: [] },
      ],
    });

    const result = await coord.runWorkflow(wf.id);
    assert.equal(result.status, 'failed');
    assert.ok(result.error, 'should have error message');
  });

  it('delegates tasks to multiple agents', async () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'x', role: 'worker' });
    coord.registerAgent({ id: 'y', role: 'worker' });

    const results = await coord.delegateTask({ description: 'shared work' }, ['x', 'y']);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.result !== null));
  });

  it('handles fan-out workflow (parallel tasks)', async () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'splitter', role: 'splitter' });
    coord.registerAgent({ id: 'w1', role: 'worker' });
    coord.registerAgent({ id: 'w2', role: 'worker' });
    coord.registerAgent({ id: 'merger', role: 'merger' });

    const wf = coord.createWorkflow({
      name: 'fan-out',
      tasks: [
        { id: 'split',   assignTo: 'splitter', dependencies: [],              description: 'Split' },
        { id: 'part-a',  assignTo: 'w1',       dependencies: ['split'],       description: 'Process A' },
        { id: 'part-b',  assignTo: 'w2',       dependencies: ['split'],       description: 'Process B' },
        { id: 'merge',   assignTo: 'merger',   dependencies: ['part-a','part-b'], description: 'Merge' },
      ],
    });

    const result = await coord.runWorkflow(wf.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.completedTasks.length, 4);
  });

  it('emits expected events during workflow run', async () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'ev-agent', role: 'analyst' });

    const events = [];
    coord.on('workflow:started',   () => events.push('workflow:started'));
    coord.on('task:started',       () => events.push('task:started'));
    coord.on('task:completed',     () => events.push('task:completed'));
    coord.on('workflow:completed', () => events.push('workflow:completed'));

    const wf = coord.createWorkflow({
      name: 'event-test',
      tasks: [{ id: 'e1', description: 'Test event', assignTo: 'ev-agent', dependencies: [] }],
    });

    await coord.runWorkflow(wf.id);
    assert.ok(events.includes('workflow:started'));
    assert.ok(events.includes('task:started'));
    assert.ok(events.includes('task:completed'));
    assert.ok(events.includes('workflow:completed'));
  });

  it('stops a workflow', () => {
    const coord = new AgentCoordinator();
    coord.registerAgent({ id: 'stop-agent', role: 'worker' });

    const wf = coord.createWorkflow({
      name: 'stop-test',
      tasks: [{ id: 's1', description: 'Will be stopped', assignTo: 'stop-agent', dependencies: [] }],
    });

    coord.workflowManager.startWorkflow(wf.id);
    coord.stopWorkflow(wf.id);
    assert.equal(coord.getWorkflow(wf.id).status, 'stopped');
  });
});
