import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut
} from "firebase/auth";
import { auth } from "../firebase";
import { getStoredAccount, saveAuthenticatedAccount } from "./session";

let confirmationResultRef = null;
let recaptchaContainerRef = "";

function destroyRecaptchaInstance() {
  const verifier = window.medilinkRecaptchaVerifier;
  if (verifier) {
    try {
      verifier.clear();
    } catch (error) {
      console.error("Failed to clear reCAPTCHA verifier:", error);
    }
    window.medilinkRecaptchaVerifier = null;
  }
}

function formatPhoneNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length !== 10) {
    throw new Error("Enter a valid 10 digit mobile number.");
  }

  return `+91${digits}`;
}

function getFriendlyPhoneAuthError(error) {
  const code = error?.code || "";

  if (code === "auth/invalid-app-credential" || code === "auth/captcha-check-failed") {
    return "OTP verification setup failed. Firebase Auth lo Phone sign-in enable chesi, Authorized domains lo localhost and 127.0.0.1 add cheyyandi, then retry cheyyandi.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Firebase Auth lo Phone provider enable cheyyaledu. Console lo Phone sign-in ni enable cheyyandi.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many OTP attempts. Konchem time tarvata malli try cheyyandi.";
  }

  return error?.message || "Could not send OTP.";
}

export function clearRecaptcha(containerId = recaptchaContainerRef || "recaptcha-container") {
  recaptchaContainerRef = containerId;
  destroyRecaptchaInstance();

  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
  }
}

export function initRecaptcha(containerId) {
  recaptchaContainerRef = containerId;

  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error("reCAPTCHA container not found.");
  }

  if (window.medilinkRecaptchaVerifier) {
    return window.medilinkRecaptchaVerifier;
  }

  container.innerHTML = "";
  window.medilinkRecaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "normal"
  });

  return window.medilinkRecaptchaVerifier;
}

export async function sendOtp(phone, containerId = "recaptcha-container") {
  try {
    clearRecaptcha(containerId);
    const verifier = initRecaptcha(containerId);
    await verifier.render();
    const formattedPhone = formatPhoneNumber(phone);
    confirmationResultRef = await signInWithPhoneNumber(auth, formattedPhone, verifier);
    return confirmationResultRef;
  } catch (error) {
    clearRecaptcha(containerId);
    throw new Error(getFriendlyPhoneAuthError(error));
  }
}

export async function verifyOtp(code) {
  if (!confirmationResultRef) {
    throw new Error("OTP session expired. Send OTP again.");
  }

  const credential = await confirmationResultRef.confirm(code);
  const user = credential.user;
  const existingAccount = getStoredAccount();

  saveAuthenticatedAccount({
    uid: user.uid,
    phone: (user.phoneNumber || existingAccount?.phone || "").replace(/^\+91/, ""),
    name: existingAccount?.name || "",
    roles: existingAccount?.roles || [],
    lastActiveRole: existingAccount?.lastActiveRole || "",
    authProvider: "phone",
    otpVerified: true
  });

  return user;
}

export function resetPhoneAuthFlow(containerId = recaptchaContainerRef || "recaptcha-container") {
  confirmationResultRef = null;
  clearRecaptcha(containerId);
}

export async function logoutPhoneAuth() {
  await signOut(auth);
}
