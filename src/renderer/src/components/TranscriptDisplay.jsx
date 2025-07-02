import React from 'react';

const TranscriptDisplay = ({ transcript, isActive }) => {
  return (
    <div className="agent-window">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Live Transcript</h2>
        <div className={`flex items-center space-x-2 ${isActive ? 'text-green-400' : 'text-gray-500'}`}>
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
          <span className="text-sm">{isActive ? 'Recording' : 'Stopped'}</span>
        </div>
      </div>
      
      <div className="min-h-[300px] max-h-[400px] overflow-y-auto bg-thinkdrop-dark/50 rounded-lg p-4">
        {transcript ? (
          <p className="transcript-text leading-relaxed">
            {transcript}
          </p>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              {isActive ? (
                <div className="space-y-2">
                  <div className="w-8 h-8 mx-auto bg-thinkdrop-teal/20 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-thinkdrop-teal rounded-full animate-pulse"></div>
                  </div>
                  <p>Listening for audio...</p>
                </div>
              ) : (
                <p>Click "Start" to begin audio capture</p>
              )}
            </div>
          </div>
        )}
      </div>
      
      {transcript && (
        <div className="mt-4 flex justify-between items-center text-xs text-gray-400">
          <span>{transcript.split(' ').length} words</span>
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

export default TranscriptDisplay;
