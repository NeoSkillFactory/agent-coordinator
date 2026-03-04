'use strict';

/**
 * agent-router.js
 *
 * Handles agent-to-agent message routing and session management.
 * Each agent is represented as an in-process session. Messages are delivered
 * via callback-based routing with optional middleware support.
 */

const { EventEmitter } = require('events');

class AgentRouter extends EventEmitter {
  /**
   * @param {object} options
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    super();
    this.verbose = options.verbose ?? false;
    this.sessions = new Map();     // agentId -> session object
    this.middleware = [];          // Array of middleware functions
    this.messageLog = [];          // Append-only message history
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Register an agent session.
   * @param {string} agentId
   */
  registerSession(agentId) {
    if (this.sessions.has(agentId)) {
      this._log(`Session already exists for agent: ${agentId}`);
      return;
    }
    this.sessions.set(agentId, {
      agentId,
      inbox: [],
      messagesSent: 0,
      messagesReceived: 0,
      createdAt: Date.now(),
    });
    this._log(`Session registered: ${agentId}`);
  }

  /**
   * Remove an agent session.
   * @param {string} agentId
   */
  removeSession(agentId) {
    if (!this.sessions.has(agentId)) {
      this._log(`No session found for agent: ${agentId}`);
      return;
    }
    this.sessions.delete(agentId);
    this._log(`Session removed: ${agentId}`);
  }

  /**
   * Check if a session exists.
   * @param {string} agentId
   * @returns {boolean}
   */
  hasSession(agentId) {
    return this.sessions.has(agentId);
  }

  /**
   * List all active sessions.
   * @returns {object[]}
   */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      agentId: s.agentId,
      messagesSent: s.messagesSent,
      messagesReceived: s.messagesReceived,
      createdAt: s.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  /**
   * Add a middleware function that intercepts messages before delivery.
   * Middleware signature: (message, next) => void
   * Call next(null, modifiedMessage) to continue, or next(error) to abort.
   * @param {Function} fn
   */
  use(fn) {
    this.middleware.push(fn);
  }

  // ---------------------------------------------------------------------------
  // Message Routing
  // ---------------------------------------------------------------------------

  /**
   * Route a message from one agent to another.
   * The message is processed through middleware and then delivered to the
   * target session's inbox. A simulated task-execution handler provides the result.
   *
   * @param {object} message - { from, to, task, [metadata] }
   * @param {Function} callback - (err, result) => void
   */
  routeMessage(message, callback) {
    const envelope = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: message.from,
      to: message.to,
      task: message.task,
      metadata: message.metadata || {},
      timestamp: Date.now(),
    };

    if (!this.sessions.has(message.to)) {
      const err = new Error(`Failed to route message from ${message.from} to ${message.to}: session not found`);
      this.emit('message:error', { ...envelope, error: err.message });
      return callback(err);
    }

    const session = this.sessions.get(message.to);

    // Run through middleware chain
    this._runMiddleware([...this.middleware], envelope, (middlewareErr, processedEnvelope) => {
      if (middlewareErr) {
        this.emit('message:error', { ...envelope, error: middlewareErr.message });
        return callback(middlewareErr);
      }

      const final = processedEnvelope || envelope;
      session.inbox.push(final);
      session.messagesReceived++;

      if (this.sessions.has(final.from)) {
        this.sessions.get(final.from).messagesSent++;
      }

      this.messageLog.push(final);
      this.emit('message:routed', { from: final.from, to: final.to, messageId: final.id });
      this._log(`Routed message ${final.id}: ${final.from} -> ${final.to}`);

      // Simulate agent processing and produce a result
      setImmediate(() => {
        const result = this._simulateAgentExecution(final);
        this.emit('message:delivered', { messageId: final.id, to: final.to, result });
        callback(null, result);
      });
    });
  }

  /**
   * Send a broadcast message to all registered sessions (except sender).
   * @param {string} fromAgentId
   * @param {object} task
   * @returns {Promise<object[]>} Array of { agentId, result } objects
   */
  broadcast(fromAgentId, task) {
    const targets = Array.from(this.sessions.keys()).filter((id) => id !== fromAgentId);
    const promises = targets.map(
      (agentId) =>
        new Promise((resolve) => {
          this.routeMessage({ from: fromAgentId, to: agentId, task }, (err, result) => {
            resolve({ agentId, error: err ? err.message : null, result: err ? null : result });
          });
        })
    );
    return Promise.all(promises);
  }

  /**
   * Get the full message log.
   * @returns {object[]}
   */
  getMessageLog() {
    return [...this.messageLog];
  }

  /**
   * Get messages in an agent's inbox.
   * @param {string} agentId
   * @returns {object[]}
   */
  getInbox(agentId) {
    if (!this.sessions.has(agentId)) {
      throw new Error(`Session not found: ${agentId}`);
    }
    return [...this.sessions.get(agentId).inbox];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Simulate agent task execution.
   * In production, this would dispatch to the actual agent process or API.
   * @param {object} envelope
   * @returns {object}
   */
  _simulateAgentExecution(envelope) {
    const { task } = envelope;
    return {
      taskId: task.id,
      agentId: envelope.to,
      status: 'success',
      output: `Agent ${envelope.to} completed task "${task.description}"`,
      completedAt: Date.now(),
    };
  }

  _runMiddleware(stack, message, done) {
    if (stack.length === 0) return done(null, message);

    const fn = stack.shift();
    try {
      fn(message, (err, processed) => {
        if (err) return done(err);
        this._runMiddleware(stack, processed || message, done);
      });
    } catch (err) {
      done(err);
    }
  }

  _log(msg) {
    if (this.verbose) {
      console.error(`[router] ${msg}`);
    }
  }
}

module.exports = { AgentRouter };
