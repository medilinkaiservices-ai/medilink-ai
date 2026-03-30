import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { resetPhoneAuthFlow, sendOtp, verifyOtp } from "../utils/phoneAuth";
import {
  ensureDevelopmentSession,
  getPostLoginPath,
  getStoredAccount,
  isDevelopmentBypassEnabled
} from "../utils/session";

function PhoneLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const existingAccount = isDevelopmentBypassEnabled() ? ensureDevelopmentSession() : getStoredAccount();
  const [phone, setPhone] = useState(existingAccount?.phone || "");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => () => resetPhoneAuthFlow(), []);

  if (isDevelopmentBypassEnabled()) {
    return <Navigate to="/" replace />;
  }

  if (existingAccount?.otpVerified) {
    const targetPath = location.state?.from || getPostLoginPath(existingAccount);
    return <Navigate to={targetPath} replace />;
  }

  const handleSendOtp = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setStatus("");
      await sendOtp(phone);
      setOtpSent(true);
      setStatus("OTP sent successfully.");
    } catch (error) {
      console.error("Failed to send OTP:", error);
      setStatus(error.message || "Could not send OTP.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setStatus("");
      await verifyOtp(otp);
      const updatedAccount = getStoredAccount();
      navigate(location.state?.from || getPostLoginPath(updatedAccount || existingAccount || {}));
    } catch (error) {
      console.error("Failed to verify OTP:", error);
      setStatus(error.message || "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="auth-layout">
        <div>
          <div className="eyebrow">Unified Login</div>
          <h1>Login with phone OTP</h1>
          <p className="muted-copy">
            Use one phone number for customer, seller, and hospital access. Roles stay inside one shared Medilink AI account.
          </p>
          <div className="feature-stack">
            <div className="soft-panel">One OTP login for all user roles.</div>
            <div className="soft-panel">Switch customer, seller, and hospital spaces from the same account.</div>
            <div className="soft-panel">Onboarding pages can add new roles later using the same number.</div>
          </div>
        </div>

        <form className="auth-card" onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
          <label>
            Mobile number
            <input
              type="text"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10));
                setStatus("");
              }}
              placeholder="10 digit mobile number"
              disabled={loading || otpSent}
              required
            />
          </label>

          {otpSent && (
            <label>
              OTP
              <input
                type="text"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                placeholder="Enter OTP"
                disabled={loading}
                required
              />
            </label>
          )}

          <div id="recaptcha-container" style={{ marginTop: "12px" }} />

          {status ? (
            <div className="muted-copy" style={{ marginTop: "12px" }}>
              {status}
            </div>
          ) : null}

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "Please wait..." : otpSent ? "Verify OTP" : "Send OTP"}
          </button>

          {otpSent ? (
            <button
              type="button"
              className="header-link"
              onClick={() => {
                resetPhoneAuthFlow();
                setOtpSent(false);
                setOtp("");
                setStatus("");
              }}
            >
              Change number
            </button>
          ) : null}

          <div className="muted-copy" style={{ marginTop: "16px" }}>
            New here? Start any role after login:
            {" "}
            <Link to="/register/customer">Customer</Link>
            {" | "}
            <Link to="/register/seller">Seller</Link>
            {" | "}
            <Link to="/register/hospital">Hospital</Link>
            {" | "}
            <Link to="/law-assistant?mode=public">Public Legal</Link>
            {" | "}
            <Link to="/law-assistant?mode=lawyer">Lawyer</Link>
          </div>

          <div className="muted-copy" style={{ marginTop: "12px" }}>
            If OTP is not sending on local system, Firebase Console lo Authentication {">"} Settings {">"} Authorized domains lo <strong>localhost</strong> and <strong>127.0.0.1</strong> add ayi undali, and Phone provider enabled undali.
          </div>
        </form>
      </div>
    </div>
  );
}

export default PhoneLogin;
