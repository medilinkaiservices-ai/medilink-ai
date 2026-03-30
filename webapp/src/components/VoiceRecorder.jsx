import React, { useRef, useState } from "react";

function VoiceRecorder({ onReady, disabled = false }) {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");

  const handleStart = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
        onReady?.(file);
        setStatus("Voice note ready to send.");
        streamRef.current?.getTracks()?.forEach((track) => track.stop());
      };

      recorder.start();
      setRecording(true);
      setStatus("Recording voice note...");
    } catch (error) {
      console.error("Voice recording failed:", error);
      setStatus("Microphone access denied or unavailable.");
    }
  };

  const handleStop = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="chat-voice-control">
      {!recording ? (
        <button
          type="button"
          className="chat-icon-button"
          disabled={disabled}
          onClick={handleStart}
          title="Record voice"
        >
          🎤
        </button>
      ) : (
        <button type="button" className="chat-icon-button chat-icon-button-live" onClick={handleStop} title="Stop recording">
          ■
        </button>
      )}
      {status ? <span className="muted-copy">{status}</span> : null}
    </div>
  );
}

export default VoiceRecorder;
