import {
  addDoc,
  arrayRemove,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { getStoredAccount, getStoredProfile } from "./session";

function getActiveRole(account) {
  if (!account?.roles?.length) return null;
  return account.lastActiveRole || account.roles[0];
}

export function getChatIdentityForRole(role) {
  const account = getStoredAccount();
  const resolvedRole = role || getActiveRole(account);

  if (!account || !resolvedRole) return null;

  const profile = getStoredProfile(resolvedRole);

  return {
    role: resolvedRole,
    phone: profile?.phone || account.phone,
    name:
      profile?.shopName ||
      profile?.hospitalName ||
      profile?.name ||
      account.name ||
      account.phone
  };
}

export function getCurrentChatIdentity() {
  return getChatIdentityForRole();
}

export async function createOrFindDirectRoom({
  targetId,
  targetType,
  targetName,
  targetPhone,
  initialMessage
}) {
  const identity = getCurrentChatIdentity();

  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  const roomQuery = query(
    collection(db, "chatRooms"),
    where("participantPhones", "array-contains", identity.phone)
  );

  const snapshot = await getDocs(roomQuery);
  const existing = snapshot.docs.find((item) => {
    const data = item.data();
    return (
      data.targetId === targetId &&
      data.targetType === targetType &&
      data.participantPhones?.includes(targetPhone)
    );
  });

  if (existing) {
    return existing.id;
  }

  const participantPhones = [identity.phone, targetPhone].filter(Boolean);

  const roomPayload = {
    targetId,
    targetType,
    targetName,
    targetPhone,
    participantPhones,
    participantRoles: [identity.role, targetType],
    participantNames: [identity.name, targetName].filter(Boolean),
    createdByPhone: identity.phone,
    lastMessage: initialMessage || "Conversation started",
    lastSenderName: identity.name,
    unreadByPhones: participantPhones.filter((phone) => phone !== identity.phone),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  const roomRef = await addDoc(collection(db, "chatRooms"), roomPayload);

  await addDoc(collection(db, "chatMessages"), {
    roomId: roomRef.id,
    senderPhone: identity.phone,
    senderName: identity.name,
    senderRole: identity.role,
    text: initialMessage || `Started chat with ${targetName}`,
    createdAt: serverTimestamp()
  });

  return roomRef.id;
}

export async function createGroupRoom({
  groupName,
  members = [],
  initialMessage
}) {
  const identity = getCurrentChatIdentity();

  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  const normalizedMembers = members
    .map((member) => ({
      phone: String(member.phone || "").trim(),
      name: String(member.name || member.phone || "").trim(),
      role: String(member.role || "contact").trim()
    }))
    .filter((member) => member.phone);

  const participantMap = new Map();
  participantMap.set(identity.phone, {
    phone: identity.phone,
    name: identity.name,
    role: identity.role
  });
  normalizedMembers.forEach((member) => {
    if (!participantMap.has(member.phone)) {
      participantMap.set(member.phone, member);
    }
  });

  const participantList = Array.from(participantMap.values());
  const participantPhones = participantList.map((item) => item.phone);
  const participantNames = participantList.map((item) => item.name);
  const participantRoles = participantList.map((item) => item.role);

  const roomRef = await addDoc(collection(db, "chatRooms"), {
    roomType: "group",
    groupName: String(groupName || "New group").trim(),
    targetType: "group",
    targetName: String(groupName || "New group").trim(),
    targetPhone: "",
    targetId: "",
    participantPhones,
    participantNames,
    participantRoles,
    memberSummaries: participantList,
    createdByPhone: identity.phone,
    lastMessage: initialMessage || "Group created",
    lastSenderName: identity.name,
    unreadByPhones: participantPhones.filter((phone) => phone !== identity.phone),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });

  await addDoc(collection(db, "chatMessages"), {
    roomId: roomRef.id,
    senderPhone: identity.phone,
    senderName: identity.name,
    senderRole: identity.role,
    text: initialMessage || `${identity.name} created the group ${groupName || "New group"}.`,
    createdAt: serverTimestamp()
  });

  return roomRef.id;
}

export function subscribeToRooms(phone, onData, onError) {
  const roomsQuery = query(
    collection(db, "chatRooms"),
    where("participantPhones", "array-contains", phone)
  );

  return onSnapshot(
    roomsQuery,
    (snapshot) => {
      const rooms = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data()
        }))
        .sort((first, second) => {
          const firstTime = first.updatedAt?.seconds || 0;
          const secondTime = second.updatedAt?.seconds || 0;
          return secondTime - firstTime;
        });

      onData(rooms);
    },
    (error) => {
      console.error("Failed to subscribe to chat rooms:", error);
      onError?.(error);
    }
  );
}

export function subscribeToMessages(roomId, onData, onError) {
  const messagesQuery = query(
    collection(db, "chatMessages"),
    where("roomId", "==", roomId),
    orderBy("createdAt", "asc")
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }))
      );
    },
    (error) => {
      console.error("Failed to subscribe to chat messages:", error);
      onError?.(error);
    }
  );
}

export async function sendChatMessage(roomId, text) {
  const identity = getCurrentChatIdentity();

  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  return sendChatMessageWithIdentity(roomId, text, identity);
}

export async function sendChatMessageWithIdentity(roomId, text, identity) {
  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  const roomSnapshot = await getDocs(query(collection(db, "chatRooms"), where("__name__", "==", roomId)));
  const roomData = roomSnapshot.docs[0]?.data() || {};
  const participantPhones = roomData.participantPhones || [];
  const unreadByPhones = participantPhones.filter((phone) => phone && phone !== identity.phone);

  await addDoc(collection(db, "chatMessages"), {
    roomId,
    senderPhone: identity.phone,
    senderName: identity.name,
    senderRole: identity.role,
    text,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "chatRooms", roomId), {
    lastMessage: text,
    lastSenderName: identity.name,
    unreadByPhones,
    updatedAt: serverTimestamp()
  });
}

export async function sendChatAttachmentWithIdentity(roomId, file, identity, caption = "") {
  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  if (!file) {
    throw new Error("Attachment file is required");
  }

  const safeName = `${Date.now()}_${String(file.name || "attachment").replace(/\s+/g, "_")}`;
  const storageRef = ref(storage, `chatAttachments/${roomId}/${safeName}`);
  const uploadResult = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(uploadResult.ref);

  const roomSnapshot = await getDocs(query(collection(db, "chatRooms"), where("__name__", "==", roomId)));
  const roomData = roomSnapshot.docs[0]?.data() || {};
  const participantPhones = roomData.participantPhones || [];
  const unreadByPhones = participantPhones.filter((phone) => phone && phone !== identity.phone);
  const attachmentKind = String(file.type || "").startsWith("image/") ? "image" : "file";
  const messageText = caption.trim() || `Shared ${attachmentKind}: ${file.name}`;

  await addDoc(collection(db, "chatMessages"), {
    roomId,
    senderPhone: identity.phone,
    senderName: identity.name,
    senderRole: identity.role,
    text: messageText,
    attachmentUrl: url,
    attachmentName: file.name || "attachment",
    attachmentType: file.type || "application/octet-stream",
    attachmentKind,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "chatRooms", roomId), {
    lastMessage: messageText,
    lastSenderName: identity.name,
    unreadByPhones,
    updatedAt: serverTimestamp()
  });
}

export async function sendChatAttachment(roomId, file, caption = "") {
  const identity = getCurrentChatIdentity();

  if (!identity?.phone) {
    throw new Error("User identity not available");
  }

  return sendChatAttachmentWithIdentity(roomId, file, identity, caption);
}

export async function sendVoiceNote(roomId, file, caption = "") {
  return sendChatAttachment(roomId, file, caption || "Voice note");
}

export async function sendVoiceNoteWithIdentity(roomId, file, identity, caption = "") {
  return sendChatAttachmentWithIdentity(roomId, file, identity, caption || "Voice note");
}

export async function markRoomAsRead(roomId, phone) {
  if (!roomId || !phone) return;

  await updateDoc(doc(db, "chatRooms", roomId), {
    unreadByPhones: arrayRemove(phone)
  });
}

export function subscribeToUnreadCount(phone, onData, onError) {
  return subscribeToRooms(
    phone,
    (rooms) => {
      const unreadCount = rooms.filter((room) => room.unreadByPhones?.includes(phone)).length;
      onData(unreadCount);
    },
    onError
  );
}

export async function createCallSession({ roomId, mode, targetName, targetPhone, targetRole }) {
  const identity = getCurrentChatIdentity();

  if (!identity?.phone || !roomId) {
    throw new Error("Call identity not available");
  }

  const callRef = doc(collection(db, "callSessions"));

  await setDoc(callRef, {
    roomId,
    mode,
    hostPhone: identity.phone,
    hostName: identity.name,
    hostRole: identity.role,
    targetPhone: targetPhone || "",
    targetRole: targetRole || "",
    targetName: targetName || "Consultation",
    status: "ringing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return callRef.id;
}

export function subscribeToCallSession(callId, onData, onError) {
  return onSnapshot(
    doc(db, "callSessions", callId),
    (snapshot) => {
      onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    },
    (error) => {
      console.error("Failed to subscribe to call session:", error);
      onError?.(error);
    }
  );
}

export async function updateCallSession(callId, patch) {
  await updateDoc(doc(db, "callSessions", callId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export function subscribeToIncomingCalls(phone, onData, onError) {
  const callsQuery = query(
    collection(db, "callSessions"),
    where("targetPhone", "==", phone)
  );

  return onSnapshot(
    callsQuery,
    (snapshot) => {
      const calls = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data()
        }))
        .filter((item) => item.status === "ringing")
        .sort((first, second) => {
          const firstTime = first.updatedAt?.seconds || 0;
          const secondTime = second.updatedAt?.seconds || 0;
          return secondTime - firstTime;
        });

      onData(calls);
    },
    (error) => {
      console.error("Failed to subscribe to incoming calls:", error);
      onError?.(error);
    }
  );
}
