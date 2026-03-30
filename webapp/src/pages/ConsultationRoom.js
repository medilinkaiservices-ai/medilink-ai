import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  createPeerConnection,
  publishCandidate,
  saveAnswer,
  saveOffer,
  subscribeToCandidates
} from "../utils/callApi";
import {
  getCurrentChatIdentity,
  subscribeToCallSession,
  updateCallSession
} from "../utils/chatApi";

function ConsultationRoom() {
  const navigate = useNavigate();
  const { callId } = useParams();
  const identity = getCurrentChatIdentity();
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [deviceReady, setDeviceReady] = useState(false);
  const [connectionState, setConnectionState] = useState("Waiting to join");
  const mediaStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const hasNegotiatedRef = useRef(false);
  const remoteDescriptionSetRef = useRef(false);

  useEffect(() => {
    if (!callId) return undefined;

    return subscribeToCallSession(
      callId,
      (nextSession) => {
        setSession(nextSession);
        setError("");
      },
      (nextError) => {
        setSession(null);
        setError(nextError?.message || "Unable to load consultation session.");
      }
    );
  }, [callId]);

  useEffect(() => {
    if (!session?.mode || !identity?.phone) return undefined;

    let isMounted = true;

    const prepareMedia = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (isMounted) {
          setDeviceError("This browser does not support microphone or camera access.");
        }
        return;
      }

      try {
        setDeviceError("");

        const constraints = session.mode === "video"
          ? { audio: true, video: true }
          : { audio: true, video: false };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;
        setDeviceReady(true);
        setMicEnabled(true);
        setCameraEnabled(session.mode === "video");

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (mediaError) {
        console.error("Failed to prepare consultation media:", mediaError);
        if (isMounted) {
          setDeviceError("Camera or microphone permission was denied. Allow access and retry.");
          setDeviceReady(false);
        }
      }
    };

    prepareMedia();

    return () => {
      isMounted = false;

      remoteDescriptionSetRef.current = false;
      hasNegotiatedRef.current = false;
      setDeviceReady(false);

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((track) => track.stop());
        remoteStreamRef.current = null;
      }

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, [identity?.phone, session?.mode]);

  useEffect(() => {
    if (!session?.hostPhone || !identity?.phone || !mediaStreamRef.current || !callId || peerConnectionRef.current) {
      return undefined;
    }

    const isHost = session.hostPhone === identity.phone;
    const peerConnection = createPeerConnection();
    peerConnectionRef.current = peerConnection;
    setConnectionState("Preparing connection");

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }

    mediaStreamRef.current.getTracks().forEach((track) => {
      peerConnection.addTrack(track, mediaStreamRef.current);
    });

    peerConnection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      setConnectionState("Remote participant connected");
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState) {
        setConnectionState(peerConnection.connectionState);
      }
    };

    peerConnection.onicecandidate = async (event) => {
      if (!event.candidate) return;
      await publishCandidate(callId, isHost ? "host" : "guest", event.candidate);
    };

    const unsubscribeRemoteCandidates = subscribeToCandidates(
      callId,
      isHost ? "guest" : "host",
      async (candidate) => {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (candidateError) {
          console.error("Failed to add ICE candidate:", candidateError);
        }
      },
      (candidateError) => {
        console.error("Candidate subscription error:", candidateError);
      }
    );

    return () => {
      unsubscribeRemoteCandidates?.();
      peerConnection.close();
      if (peerConnectionRef.current === peerConnection) {
        peerConnectionRef.current = null;
      }
    };
  }, [callId, identity?.phone, session?.hostPhone]);

  useEffect(() => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection || !session || !identity?.phone || !callId) return undefined;

    const isHost = session.hostPhone === identity.phone;

    const negotiate = async () => {
      try {
        if (isHost && !session.offer && !hasNegotiatedRef.current) {
          hasNegotiatedRef.current = true;
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await saveOffer(callId, offer);
          setConnectionState("Offer sent");
          return;
        }

        if (!isHost && session.offer && !session.answer && !hasNegotiatedRef.current) {
          hasNegotiatedRef.current = true;
          await peerConnection.setRemoteDescription(new RTCSessionDescription(session.offer));
          remoteDescriptionSetRef.current = true;
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await saveAnswer(callId, answer);
          setConnectionState("Answer sent");
          return;
        }

        if (isHost && session.answer && !remoteDescriptionSetRef.current) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(session.answer));
          remoteDescriptionSetRef.current = true;
          setConnectionState("Connected to answer");
        }
      } catch (negotiationError) {
        console.error("Negotiation error:", negotiationError);
        setDeviceError("Unable to complete call negotiation. Refresh and try again.");
      }
    };

    negotiate();
    return undefined;
  }, [callId, identity?.phone, session]);

  const title = useMemo(() => {
    if (!session) return "Consultation room";
    return session.mode === "video" ? "Video consultation" : "Audio consultation";
  }, [session]);

  if (!identity) {
    return <Navigate to="/register/customer" replace />;
  }

  const handleJoin = async () => {
    await updateCallSession(callId, {
      status: session?.status === "ringing" ? "accepted" : "live",
      joinedByName: identity.name,
      joinedByPhone: identity.phone
    });
    setHasJoined(true);
  };

  const handleEnd = async () => {
    await updateCallSession(callId, {
      status: "ended",
      endedByName: identity.name
    });

    navigate("/connect");
  };

  const handleToggleMic = () => {
    if (!mediaStreamRef.current) return;

    const nextEnabled = !micEnabled;
    mediaStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setMicEnabled(nextEnabled);
  };

  const handleToggleCamera = () => {
    if (!mediaStreamRef.current) return;

    const nextEnabled = !cameraEnabled;
    mediaStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setCameraEnabled(nextEnabled);
  };

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Consultation</div>
          <h1>{title}</h1>
          <p className="muted-copy">
            This is the consultation scaffold. Next we can plug real WebRTC media into this room.
          </p>
        </div>
        <div className="identity-card">
          <div className="identity-label">Your identity</div>
          <div className="identity-value">{identity.name}</div>
          <div className="identity-label">Mode</div>
          <div className="identity-value">{session?.mode || "Loading"}</div>
          <div className="identity-label">Status</div>
          <div className="identity-value">{session?.status || "Preparing"}</div>
          <div className="identity-label">Connection</div>
          <div className="identity-value">{connectionState}</div>
        </div>
      </section>

      <section className="seller-two-column">
        <div className="soft-panel consultation-stage">
          {error && <p className="muted-copy">{error}</p>}
          {session === undefined && <p className="muted-copy">Loading consultation room...</p>}
          {session && (
            <>
              <div className="consultation-screen">
                <div className="eyebrow">{session.mode === "video" ? "Camera stage" : "Voice stage"}</div>
                <h2>{session.targetName || "Consultation participant"}</h2>
                <p className="muted-copy">
                  Session status: {session.status}. When you are ready, join and continue from chat.
                </p>
                {session.mode === "video" && (
                  <div className="consultation-video-grid">
                    <div className="consultation-video-shell">
                      <video
                        ref={localVideoRef}
                        className="consultation-video"
                        autoPlay
                        muted
                        playsInline
                      />
                      <div className="consultation-video-tag">You</div>
                      {!deviceReady && <div className="consultation-video-overlay">Preparing camera preview...</div>}
                      {deviceReady && !cameraEnabled && (
                        <div className="consultation-video-overlay">Camera is turned off</div>
                      )}
                    </div>
                    <div className="consultation-video-shell">
                      <video
                        ref={remoteVideoRef}
                        className="consultation-video"
                        autoPlay
                        playsInline
                      />
                      <div className="consultation-video-tag">
                        {session.targetName || "Remote participant"}
                      </div>
                      <div className="consultation-video-overlay consultation-video-overlay-soft">
                        {connectionState === "Remote participant connected"
                          ? "Remote participant joined"
                          : "Waiting for remote participant"}
                      </div>
                    </div>
                  </div>
                )}
                {session.mode === "audio" && (
                  <div className="consultation-audio-shell">
                    <div className="consultation-audio-wave" />
                    <div>
                      <strong>Audio room ready</strong>
                      <p className="muted-copy">
                        Microphone access is prepared for this consultation.
                      </p>
                    </div>
                  </div>
                )}
                {deviceError && <p className="muted-copy">{deviceError}</p>}
              </div>
              <div className="account-actions">
                <button type="button" className="primary-button" onClick={handleJoin}>
                  Join {session.mode} consultation
                </button>
                <button type="button" className="header-link" onClick={handleToggleMic}>
                  {micEnabled ? "Mute mic" : "Unmute mic"}
                </button>
                {session.mode === "video" && (
                  <button type="button" className="header-link" onClick={handleToggleCamera}>
                    {cameraEnabled ? "Turn camera off" : "Turn camera on"}
                  </button>
                )}
                <button type="button" className="header-link" onClick={handleEnd}>
                  End consultation
                </button>
              </div>
              <div className="soft-panel">
                <div className="section-title">Live room status</div>
                <p className="muted-copy">
                  {hasJoined || session.status === "live"
                    ? "You have joined the room. Open the same consultation from the other side to complete the connection."
                    : session.status === "ringing"
                      ? "Call is ringing. The other side should accept from their inbox first."
                      : "Device preparation is ready. Join now to mark the consultation as live."}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="soft-panel">
          <div className="section-title">What this stage is ready for</div>
          <p className="muted-copy">
            We now have call session creation, shareable room state and role-aware entry points.
            Next step is real audio/video streams, mute controls, camera toggles and consultation notes.
          </p>
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-link" to="/connect">
              Back to customer chat
            </Link>
            <Link className="header-link" to="/hospital/inbox">
              Hospital inbox
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ConsultationRoom;
