import React, { useState, useEffect, useMemo } from "react";
import QRCode from "qrcode";
import { getStoredAccount, getStoredProfile } from "../utils/session";

/**
 * QRCodeManager handles multi-role QR generation.
 * Encodes URLs: /customer/{id}, /shop/{id}, /hospital/{id}
 */
function QRCodeManager() {
  const account = getStoredAccount();
  const baseUrl = window.location.origin;

  const availableRoles = useMemo(
    () => (account?.roles?.length ? account.roles : ["customer"]),
    [account]
  );
  const [selectedRole, setSelectedRole] = useState(availableRoles[0] || "customer");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [status, setStatus] = useState("");
  
  // Custom metadata fields for the printed QR card
  const [customName, setCustomName] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [customLabel, setCustomLabel] = useState("Scan to open");
  const selectedProfile = getStoredProfile(selectedRole === "seller" ? "seller" : selectedRole);

  useEffect(() => {
    setSelectedRole(availableRoles[0] || "customer");
  }, [availableRoles]);

  useEffect(() => {
    let path = "customer/account";

    if (selectedRole === "seller") {
      path = selectedProfile?.shopId ? `shop/${selectedProfile.shopId}` : "search";
    }

    if (selectedRole === "hospital") {
      path = selectedProfile?.hospitalId ? `hospitals/${selectedProfile.hospitalId}` : "hospitals";
    }

    const url = `${baseUrl}/${path}`;
    setTargetUrl(url);
    generateQR(url);
  }, [selectedRole, account, selectedProfile, baseUrl]);

  useEffect(() => {
    if (!selectedProfile) return;
    setCustomName(
      selectedRole === "seller"
        ? selectedProfile.shopName || selectedProfile.name || ""
        : selectedRole === "hospital"
          ? selectedProfile.hospitalName || selectedProfile.name || ""
          : selectedProfile.name || ""
    );
    setCustomLocation(
      selectedProfile.area ||
      selectedProfile.city ||
      selectedProfile.address ||
      ""
    );
  }, [selectedRole, selectedProfile]);

  const generateQR = async (text) => {
    try {
      const dataUrl = await QRCode.toDataURL(text, {
        width: 400,
        margin: 2,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error("QR Generation failed:", err);
    }
  };

  const getRoleTitle = (role) => {
    if (role === "seller") return "Shop QR";
    if (role === "hospital") return "Hospital QR";
    return "Customer QR";
  };

  const buildCardCanvas = () => {
    if (!qrDataUrl) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    const context = canvas.getContext("2d");

    if (!context) return null;

    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const gradient = context.createLinearGradient(0, 0, canvas.width, 260);
    gradient.addColorStop(0, "#0f766e");
    gradient.addColorStop(1, "#99f6e4");
    context.fillStyle = gradient;
    context.fillRect(60, 60, 960, 220);

    context.fillStyle = "#0f172a";
    context.font = "700 34px Arial";
    context.fillText("MEDILINK AI", 110, 140);
    context.font = "800 58px Arial";
    context.fillText(customName || getRoleTitle(selectedRole), 110, 215);

    context.fillStyle = "#334155";
    context.font = "500 28px Arial";
    context.fillText(customLocation || "Open in Medilink AI", 110, 256);

    context.fillStyle = "#ffffff";
    context.strokeStyle = "#e2e8f0";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(120, 340, 840, 840, 28);
    context.fill();
    context.stroke();

    const qrImage = new Image();
    qrImage.src = qrDataUrl;
    context.drawImage(qrImage, 210, 430, 660, 660);

    context.fillStyle = "#0f766e";
    context.font = "700 34px Arial";
    context.textAlign = "center";
    context.fillText(customLabel || "Scan to open", canvas.width / 2, 1240);

    context.fillStyle = "#64748b";
    context.font = "500 24px Arial";
    context.fillText(`${getRoleTitle(selectedRole)} • ${targetUrl}`, canvas.width / 2, 1290);
    context.textAlign = "start";

    return canvas;
  };

  const handleDownload = () => {
    const canvas = buildCardCanvas();
    if (!canvas) return;

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${selectedRole}-medilink-qr.png`;
    link.click();
    setStatus("QR card downloaded.");
  };

  const handlePrint = () => {
    const canvas = buildCardCanvas();
    if (!canvas) return;

    const previewWindow = window.open("", "_blank", "width=900,height=1200");
    if (!previewWindow) {
      setStatus("Allow popups to print the QR card.");
      return;
    }

    previewWindow.document.write(`
      <html>
        <head>
          <title>Print QR</title>
          <style>
            body { margin: 0; display: grid; place-items: center; background: #e2e8f0; }
            img { width: 90%; max-width: 720px; margin: 24px auto; display: block; }
          </style>
        </head>
        <body>
          <img src="${canvas.toDataURL("image/png")}" alt="QR Card" />
          <script>
            window.onload = function () { window.print(); };
          </script>
        </body>
      </html>
    `);
    previewWindow.document.close();
    setStatus("Print preview opened.");
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setStatus("QR link copied.");
    } catch (error) {
      console.error("Could not copy QR link:", error);
      setStatus("Could not copy the QR link.");
    }
  };

  return (
    <div className="soft-panel premium-qr-manager" style={{ maxWidth: "500px", margin: "20px auto" }}>
      <div className="eyebrow">Identity System</div>
      <h2>Generate Professional QR</h2>
      
      <div style={{ display: "grid", gap: "12px", marginBottom: "20px" }}>
        <label style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>
          Target Dashboard
          <select 
            style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            value={selectedRole} 
            onChange={(e) => setSelectedRole(e.target.value)}
          >
            {availableRoles.includes("customer") && <option value="customer">Customer QR</option>}
            {availableRoles.includes("seller") && <option value="seller">Shop QR</option>}
            {availableRoles.includes("hospital") && <option value="hospital">Hospital QR</option>}
          </select>
        </label>
        
        <label style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>
          Business/User Name
          <input 
            style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            type="text" 
            placeholder="e.g. Medilink AI Hospital" 
            value={customName} 
            onChange={(e) => setCustomName(e.target.value)} 
          />
        </label>

        <label style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>
          Location
          <input 
            style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            type="text" 
            placeholder="e.g. Kondapur, Hyderabad" 
            value={customLocation} 
            onChange={(e) => setCustomLocation(e.target.value)} 
          />
        </label>

        <label style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>
          QR Label Text
          <input 
            style={{ width: "100%", padding: "8px", marginTop: "4px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            type="text" 
            placeholder="e.g. Scan to open" 
            value={customLabel} 
            onChange={(e) => setCustomLabel(e.target.value)} 
          />
        </label>
      </div>

      <div style={{ marginBottom: "16px", fontSize: "13px", color: "#64748b", wordBreak: "break-all" }}>
        Target link: {targetUrl}
      </div>

      <div id="printable-qr" style={{ textAlign: "center", padding: "32px", background: "white", borderRadius: "16px", border: "1px solid #f1f5f9", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }}>
        {qrDataUrl && <img src={qrDataUrl} alt="QR Code" style={{ width: "240px", height: "240px" }} />}
        <div style={{ marginTop: "16px", color: "#0f172a" }}>
          {customName && <div style={{ fontWeight: 700, fontSize: "1.25rem" }}>{customName}</div>}
          {customLocation && <div style={{ fontSize: "1rem", color: "#64748b" }}>{customLocation}</div>}
          <div style={{ marginTop: "8px", fontWeight: 600, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.05em" }}>{customLabel}</div>
          <div style={{ marginTop: "8px", fontSize: "0.85rem", color: "#94a3b8" }}>
            Role: {selectedRole}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "18px" }}>
        <button type="button" className="primary-button" onClick={handleDownload}>
          Download PNG
        </button>
        <button type="button" className="header-link" onClick={handlePrint}>
          Print QR
        </button>
        <button type="button" className="header-link" onClick={handleCopyLink}>
          Copy Link
        </button>
      </div>

      {status ? (
        <div style={{ marginTop: "12px", fontSize: "13px", color: "#0f766e", fontWeight: 600 }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}

export default QRCodeManager;
