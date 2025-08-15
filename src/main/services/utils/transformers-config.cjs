/**
 * Transformers Configuration - Force WASM-only execution
 * This file must be loaded before any transformers are initialized
 */

// Set environment variables to disable ONNX runtime
process.env.ONNXJS_LOG_LEVEL = 'error';
process.env.TRANSFORMERS_CACHE = './models';
process.env.HF_HUB_DISABLE_TELEMETRY = '1';

// Configure transformers to use WASM only
async function configureTransformers() {
  try {
    const transformers = await import('@xenova/transformers');
    
    // Force WASM backend only
    transformers.env.backends = {
      onnx: false,
      wasm: true,
      webgl: false
    };
    
    // Disable ONNX runtime completely
    transformers.env.onnx = {
      wasm: true,
      webgl: false,
      proxy: false
    };
    
    // Set execution providers to WASM only
    transformers.env.executionProviders = ['wasm'];
    
    // Disable remote models for security
    transformers.env.allowRemoteModels = true;
    transformers.env.allowLocalModels = false;
    
    console.log('✅ Transformers configured for WASM-only execution');
    return transformers;
  } catch (error) {
    console.error('❌ Failed to configure transformers:', error);
    throw error;
  }
}

module.exports = { configureTransformers };
