#!/usr/bin/env node
'use strict';

/**
 * cli.js
 *
 * Command-line interface for the agent-coordinator skill.
 * Provides commands for starting, listing, monitoring, stopping, and
 * delegating workflows across multiple agents.
 */

const { Command } = require('commander');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { AgentCoordinator } = require('./agent-coordinator');

const program = new Command();

program
  .name('agent-coordinator')
  .description('Coordinates multiple AI agents to collaborate on complex tasks')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadConfig(configPath) {
  try {
    const abs = resolve(process.cwd(), configPath);
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    fatal(`Failed to load config from "${configPath}": ${err.message}`);
  }
}

function buildCoordinatorFromConfig(config, verbose) {
  const opts = {
    maxRetries: config.workflow?.maxRetries ?? 3,
    timeoutMs: config.workflow?.timeoutMs ?? 30000,
    verbose,
  };
  const coordinator = new AgentCoordinator(opts);

  if (Array.isArray(config.agents)) {
    for (const agent of config.agents) {
      coordinator.registerAgent(agent);
    }
  }

  return coordinator;
}

function printJSON(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fatal(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

program
  .command('start')
  .description('Start a new multi-agent workflow')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-t, --task <description>', 'Override top-level task description')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);

    // Override task description if provided
    if (options.task && Array.isArray(config.tasks) && config.tasks.length > 0) {
      config.tasks[0].description = options.task;
    }

    const tasks = config.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      fatal('Config must include a non-empty "tasks" array');
    }

    const workflowName = options.task ? options.task : (config.workflow?.name || 'cli-workflow');
    const workflow = coordinator.createWorkflow({
      name: workflowName,
      tasks,
    });

    console.error(`Starting workflow: ${workflow.name} (${workflow.id})`);

    const result = await coordinator.runWorkflow(workflow.id);

    printJSON({
      workflowId: result.workflowId,
      status: result.status,
      summary: result.summary,
      completedTasks: result.completedTasks?.length ?? 0,
      failedTasks: result.failedTasks?.length ?? 0,
      durationMs: result.durationMs,
      error: result.error ?? null,
    });

    if (result.status !== 'completed') {
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

program
  .command('list')
  .description('List active and recent workflows (requires --config for coordinator state)')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action((options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);
    const workflows = coordinator.listWorkflows();

    if (workflows.length === 0) {
      console.log('No workflows found.');
      return;
    }

    printJSON(
      workflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        status: wf.status,
        totalTasks: wf.totalTasks,
        completedTasks: wf.completedTasks,
        failedTasks: wf.failedTasks,
        createdAt: new Date(wf.createdAt).toISOString(),
      }))
    );
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Get detailed status for a workflow')
  .requiredOption('-w, --workflow <id>', 'Workflow ID')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action((options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);

    let status;
    try {
      status = coordinator.workflowManager.getStatus(options.workflow);
    } catch (err) {
      fatal(err.message);
    }

    printJSON(status);
  });

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

program
  .command('stop')
  .description('Stop a running workflow')
  .requiredOption('-w, --workflow <id>', 'Workflow ID')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action((options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);

    try {
      coordinator.stopWorkflow(options.workflow);
    } catch (err) {
      fatal(err.message);
    }

    printJSON({ workflowId: options.workflow, status: 'stopped' });
  });

// ---------------------------------------------------------------------------
// delegate
// ---------------------------------------------------------------------------

program
  .command('delegate')
  .description('Delegate a task to specific agents')
  .requiredOption('-t, --task <description>', 'Task description')
  .requiredOption('-a, --agents <ids>', 'Comma-separated list of agent IDs')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);

    const agentIds = options.agents.split(',').map((s) => s.trim()).filter(Boolean);
    if (agentIds.length === 0) {
      fatal('--agents must include at least one agent ID');
    }

    const results = await coordinator.delegateTask(
      { description: options.task },
      agentIds
    );

    printJSON(results);
  });

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

program
  .command('summary')
  .description('Show workflow summary and metrics')
  .requiredOption('-w, --workflow <id>', 'Workflow ID')
  .option('-c, --config <path>', 'Path to workflow config JSON', 'assets/config-template.json')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action((options) => {
    const config = loadConfig(options.config);
    const coordinator = buildCoordinatorFromConfig(config, options.verbose);

    let wfStatus;
    try {
      wfStatus = coordinator.workflowManager.getStatus(options.workflow);
    } catch (err) {
      fatal(err.message);
    }

    const successRate =
      wfStatus.totalTasks > 0
        ? ((wfStatus.completedTasks / wfStatus.totalTasks) * 100).toFixed(1)
        : '0.0';

    printJSON({
      workflowId: options.workflow,
      name: wfStatus.name,
      status: wfStatus.status,
      totalTasks: wfStatus.totalTasks,
      completedTasks: wfStatus.completedTasks,
      failedTasks: wfStatus.failedTasks,
      pendingTasks: wfStatus.pendingTasks,
      successRate: `${successRate}%`,
      durationMs: wfStatus.durationMs,
      error: wfStatus.error ?? null,
    });
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
