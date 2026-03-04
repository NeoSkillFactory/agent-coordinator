# Coordination Patterns

Best practices and architectural patterns for multi-agent coordination with agent-coordinator.

---

## 1. Sequential Pipeline

Tasks execute one after another. Each task depends on the previous one.

**Use when**: Output of task A is required as input for task B.

```json
{
  "tasks": [
    { "id": "analyze", "description": "Analyze codebase", "assignTo": "analyst", "dependencies": [] },
    { "id": "test",    "description": "Run tests",        "assignTo": "tester",  "dependencies": ["analyze"] },
    { "id": "deploy",  "description": "Deploy to staging","assignTo": "executor","dependencies": ["test"] }
  ]
}
```

**Pros**: Simple, easy to reason about.
**Cons**: Sequential bottleneck; one slow task delays everything downstream.

---

## 2. Fan-Out / Fan-In (Parallel Aggregation)

One task fans out to N independent workers, then a final task collects results.

**Use when**: Work can be parallelised across agents (e.g. process multiple files simultaneously).

```json
{
  "tasks": [
    { "id": "split",     "description": "Split dataset",        "assignTo": "coordinator", "dependencies": [] },
    { "id": "process-a", "description": "Process partition A",  "assignTo": "worker-a",    "dependencies": ["split"] },
    { "id": "process-b", "description": "Process partition B",  "assignTo": "worker-b",    "dependencies": ["split"] },
    { "id": "process-c", "description": "Process partition C",  "assignTo": "worker-c",    "dependencies": ["split"] },
    { "id": "merge",     "description": "Merge all results",    "assignTo": "coordinator", "dependencies": ["process-a","process-b","process-c"] }
  ]
}
```

**Pros**: High throughput; linear speedup as agents scale.
**Cons**: Requires a merge step; coordinator must handle partial failures.

---

## 3. Event-Driven Coordination

Agents react to events rather than being scheduled in advance. The coordinator listens for `task:completed` events and triggers follow-up tasks dynamically.

**Use when**: Workflow shape is not fully known ahead of time (e.g. adaptive testing).

```javascript
coordinator.on('task:completed', ({ taskId, result }) => {
  if (taskId === 'discovery' && result.coverage < 80) {
    // Dynamically add extra test task
    coordinator.delegateTask({ description: 'Increase test coverage' }, ['tester-extra']);
  }
});
```

**Pros**: Flexible, adaptive to runtime conditions.
**Cons**: Harder to audit; non-deterministic ordering.

---

## 4. Retry with Exponential Back-off

Failed tasks are retried with increasing delays to handle transient errors.

Built-in to agent-coordinator via `maxRetries` option. The delay between attempt `n` is `500ms * n`.

**Best practices**:
- Set `maxRetries: 5` for tasks talking to external services.
- Keep `maxRetries: 1` for idempotent tasks that are unlikely to recover (e.g. compilation).
- Log retry events and surface them in workflow summaries.

---

## 5. Specialist Routing

Route tasks to agents based on declared capabilities rather than hard-coded IDs.

```javascript
function findCapableAgent(coordinator, capability) {
  return coordinator.listAgents().find(
    (a) => a.status === 'idle' && a.capabilities.includes(capability)
  );
}

const agent = findCapableAgent(coordinator, 'code-analysis');
if (!agent) throw new Error('No capable agent available');
```

**Pros**: Decouples task definitions from specific agent IDs.
**Cons**: Requires capability declarations to be kept up to date.

---

## 6. State-Machine Workflow

Workflow progresses through defined states: `init -> analysing -> testing -> deploying -> done`.
Only valid transitions are allowed, preventing illegal state jumps.

Implement by checking `workflow.status` before each state transition and throwing if the current state doesn't allow the requested transition.

---

## Communication Best Practices

1. **Idempotent tasks**: Design tasks so they can be safely re-run (idempotency) — this makes retry logic safe.
2. **Structured results**: Always return `{ status, output, metadata }` from agent executions for consistent parsing.
3. **Explicit dependencies**: Declare all dependencies upfront; avoid implicit ordering assumptions.
4. **Bounded timeouts**: Always set `timeoutMs` to prevent workflows from hanging indefinitely.
5. **Centralised logging**: Route all agent events through the coordinator's event emitter for unified audit trails.
6. **Graceful degradation**: Use fallback agents when primary agents fail; never leave a workflow stalled.
