import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ensureDevelopmentSession, getStoredAccount, isDevelopmentBypassEnabled } from "../utils/session";

function RequireAuth({ children }) {
  const location = useLocation();
  const account = isDevelopmentBypassEnabled() ? ensureDevelopmentSession() : getStoredAccount();

  if (isDevelopmentBypassEnabled()) {
    return children;
  }

  if (!account?.otpVerified) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default RequireAuth;
