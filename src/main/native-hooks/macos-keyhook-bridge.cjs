const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class MacOSKeyHookBridge extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.process = null;
    this.isReady = false;
    this.isCaptureActive = false;
  }

  start() {
    if (this.process) {
      this.logger.warn('[KeyHook] Process already running');
      return;
    }

    const helperPath = path.join(__dirname, 'bin', 'macos-keyhook');
    
    this.logger.info(`[KeyHook] Starting helper: ${helperPath}`);
    
    this.process = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => this.handleMessage(line));
    });

    this.process.stderr.on('data', (data) => {
      this.logger.error(`[KeyHook] stderr: ${data}`);
    });

    this.process.on('error', (error) => {
      this.logger.error(`[KeyHook] Process error: ${error.message}`);
      this.emit('error', error);
    });

    this.process.on('exit', (code, signal) => {
      this.logger.info(`[KeyHook] Process exited: code=${code}, signal=${signal}`);
      this.process = null;
      this.isReady = false;
      this.isCaptureActive = false;
      this.emit('exit', { code, signal });
    });
  }

  handleMessage(line) {
    try {
      const message = JSON.parse(line);
      
      switch (message.type) {
        case 'status':
          this.logger.info(`[KeyHook] Status: ${message.data?.message}`);
          if (message.data?.ready) {
            this.isReady = true;
            this.emit('ready');
          }
          break;

        case 'captureStarted':
          this.logger.info('[KeyHook] Capture started');
          this.isCaptureActive = true;
          this.emit('captureStarted');
          break;

        case 'captureStopped':
          this.logger.info('[KeyHook] Capture stopped');
          this.isCaptureActive = false;
          this.emit('captureStopped');
          break;

        case 'keyDown':
          this.emit('keyEvent', {
            type: 'keyDown',
            key: message.key,
            keyCode: message.keyCode,
            modifiers: message.modifiers,
            timestamp: message.timestamp
          });
          break;

        case 'error':
          this.logger.error(`[KeyHook] Error: ${message.error}`);
          this.emit('error', new Error(message.error));
          break;

        case 'pong':
          this.emit('pong');
          break;

        case 'shutdown':
          this.logger.info('[KeyHook] Shutdown acknowledged');
          break;

        default:
          this.logger.warn(`[KeyHook] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.logger.error(`[KeyHook] Failed to parse message: ${line}`, error);
    }
  }

  sendCommand(command, data = null) {
    if (!this.process || !this.process.stdin.writable) {
      this.logger.error('[KeyHook] Cannot send command: process not running');
      return false;
    }

    const message = JSON.stringify({ command, data }) + '\n';
    this.process.stdin.write(message);
    return true;
  }

  startCapture() {
    if (!this.isReady) {
      this.logger.error('[KeyHook] Cannot start capture: helper not ready');
      return false;
    }
    return this.sendCommand('startCapture');
  }

  stopCapture() {
    return this.sendCommand('stopCapture');
  }

  ping() {
    return this.sendCommand('ping');
  }

  shutdown() {
    if (this.process) {
      this.sendCommand('shutdown');
      setTimeout(() => {
        if (this.process) {
          this.logger.warn('[KeyHook] Force killing process');
          this.process.kill('SIGTERM');
        }
      }, 1000);
    }
  }
}

module.exports = MacOSKeyHookBridge;
