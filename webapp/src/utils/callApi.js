import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  updateDoc
} from "firebase/firestore";
import { db } from "../firebase";

const RTC_CONFIGURATION = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] }
  ]
};

export function createPeerConnection() {
  return new RTCPeerConnection(RTC_CONFIGURATION);
}

export function getCandidateCollection(callId, side) {
  return collection(db, "callSessions", callId, side === "host" ? "hostCandidates" : "guestCandidates");
}

export async function publishCandidate(callId, side, candidate) {
  if (!callId || !candidate) return;

  await addDoc(getCandidateCollection(callId, side), candidate.toJSON());
}

export function subscribeToCandidates(callId, side, onCandidate, onError) {
  return onSnapshot(
    getCandidateCollection(callId, side),
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        onCandidate(change.doc.data());
      });
    },
    (error) => {
      console.error("Failed to subscribe to call candidates:", error);
      onError?.(error);
    }
  );
}

export async function saveOffer(callId, description) {
  await updateDoc(doc(db, "callSessions", callId), {
    offer: {
      type: description.type,
      sdp: description.sdp
    }
  });
}

export async function saveAnswer(callId, description) {
  await updateDoc(doc(db, "callSessions", callId), {
    answer: {
      type: description.type,
      sdp: description.sdp
    }
  });
}
