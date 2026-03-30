import React from "react";
import { Navigate } from "react-router-dom";
import {
  ensureDevelopmentSession,
  getStoredAccount,
  getStoredProfile,
  isDevelopmentBypassEnabled
} from "../utils/session";

function RequireRole({ role, children }) {
  const account = isDevelopmentBypassEnabled() ? ensureDevelopmentSession() : getStoredAccount();
  const profile = getStoredProfile(role);

  if (isDevelopmentBypassEnabled()) {
    return children;
  }

  if (!account) {
    return <Navigate to="/login" replace />;
  }

  if (!account.roles?.includes(role) || !profile) {
    const registerPath =
      role === "seller"
        ? "/register/seller"
        : role === "hospital"
          ? "/register/hospital"
          : role === "lawyer"
            ? "/law-assistant?mode=lawyer"
            : role === "public"
              ? "/law-assistant?mode=public"
          : "/register/customer";

    return <Navigate to={registerPath} replace />;
  }

  return children;
}

export default RequireRole;
