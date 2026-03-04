---
name: agent-coordinator
description: Coordinates multiple AI agents to collaborate on complex tasks with seamless communication and task delegation
---

# agent-coordinator

Coordinates multiple AI agents to collaborate on complex tasks with seamless communication and task delegation.

## Core Capabilities

- Manage agent-to-agent communication and message routing between OpenClaw sessions
- Delegate subtasks between specialized agents based on expertise and availability
- Orchestrate multi-agent workflows with dependency management and task sequencing
- Handle agent failures and retry strategies with graceful error recovery
- Provide real-time status monitoring and logging of coordinated agent activities
- Generate comprehensive workflow summaries and performance metrics

## Triggers

This skill activates when users request:

- "Create a multi-agent workflow to analyze and deploy a web application"
- "Coordinate agents to work on a complex data processing pipeline"
- "Set up agent collaboration for a DevOps automation project"
- "Build a pipeline with multiple specialized agents for code review and testing"
- "Automate task delegation between AI agents for content creation and SEO optimization"
- Any request involving multi-agent coordination, workflow orchestration, or task delegation

## Technical Requirements

- Node.js >= 18.0.0
- npm >= 8.0.0

### File Dependencies

```
scripts/
  agent-coordinator.js  - Main coordination engine
  agent-router.js       - Message routing and session management
  workflow-manager.js   - Dependency tracking and sequencing
  cli.js                - Command-line interface
assets/
  config-template.json  - Default configuration template
  example-workflows/    - Sample workflow implementations
references/
  patterns.md           - Coordination patterns and best practices
  examples.md           - Real-world workflow examples
```

## API Reference

### CLI Commands

```bash
# Start a new multi-agent workflow
node scripts/cli.js start --config <config.json> --task "<description>"

# List active workflows
node scripts/cli.js list

# Get workflow status
node scripts/cli.js status --workflow <workflow-id>

# Stop a workflow
node scripts/cli.js stop --workflow <workflow-id>

# Delegate a task to specific agents
node scripts/cli.js delegate --agents <agent1,agent2> --task "<description>"

# Show workflow summary and metrics
node scripts/cli.js summary --workflow <workflow-id>
```

### Configuration Format

```json
{
  "workflow": {
    "name": "my-workflow",
    "maxRetries": 3,
    "timeoutMs": 30000
  },
  "agents": [
    {
      "id": "agent-1",
      "role": "analyst",
      "capabilities": ["code-analysis", "testing"]
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "description": "Analyze codebase",
      "assignTo": "agent-1",
      "dependencies": []
    }
  ]
}
```

### Programmatic API

```javascript
const { AgentCoordinator } = require('./scripts/agent-coordinator');

const coordinator = new AgentCoordinator({ maxRetries: 3 });

// Register agents
coordinator.registerAgent({ id: 'agent-1', role: 'analyst' });
coordinator.registerAgent({ id: 'agent-2', role: 'executor' });

// Define and run a workflow
const workflow = coordinator.createWorkflow({
  name: 'my-workflow',
  tasks: [
    { id: 't1', description: 'Analyze', assignTo: 'agent-1', dependencies: [] },
    { id: 't2', description: 'Execute', assignTo: 'agent-2', dependencies: ['t1'] }
  ]
});

const result = await coordinator.runWorkflow(workflow.id);
console.log(result.summary);
```

## Troubleshooting

### Agent Not Responding

```
Error: Agent agent-1 timed out after 30000ms
```

**Fix**: Check agent availability, increase `timeoutMs` in config, or implement a fallback agent.

### Circular Dependency Detected

```
Error: Circular dependency detected in task graph: t1 -> t2 -> t1
```

**Fix**: Review your task dependency graph and remove circular references.

### Workflow Stalled

```
Warning: Workflow my-workflow has been in RUNNING state for >5 minutes
```

**Fix**: Use `node scripts/cli.js status --workflow <id>` to inspect which tasks are blocked, then resolve agent issues or force-retry failed tasks.

### Message Routing Failure

```
Error: Failed to route message from agent-1 to agent-2: session not found
```

**Fix**: Ensure both agents are registered and their sessions are active before starting the workflow.
