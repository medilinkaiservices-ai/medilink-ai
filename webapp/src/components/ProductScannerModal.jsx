import React, { useEffect, useRef, useState } from "react";

const SCAN_FORMATS = [
  "qr_code",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39"
];

function ProductScannerModal({ open, onClose, onDetected }) {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const supportsDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
  const [status, setStatus] = useState("Allow camera access to scan QR or barcode.");
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (!supportsDetector) {
      setStatus("Live QR/barcode scan is not supported in this browser. Type or paste the code below to continue.");
      return undefined;
    }

    const detector = new window.BarcodeDetector({ formats: SCAN_FORMATS });

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus("Camera access is not available here. Type or paste the code below.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setStatus("Scanning live camera feed...");

        scanTimerRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          try {
            const results = await detector.detect(videoRef.current);
            const code = results?.[0]?.rawValue;

            if (code) {
              setStatus(`Detected: ${code}`);
              onDetected(code);
              onClose();
            }
          } catch (error) {
            console.error("Live scan failed:", error);
          }
        }, 900);
      } catch (error) {
        console.error("Camera access failed:", error);
        setStatus("Camera access failed. Try image upload scan instead.");
      }
    };

    startCamera();

    return () => {
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [open, onClose, onDetected, supportsDetector]);

  if (!open) {
    return null;
  }

  const handleImageScan = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!supportsDetector) {
      setStatus("Image scan is not available in this browser. Type or paste the code below.");
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const detector = new window.BarcodeDetector({ formats: SCAN_FORMATS });
      const results = await detector.detect(bitmap);
      const code = results?.[0]?.rawValue;

      if (!code) {
        setStatus("No QR or barcode detected in this image.");
        return;
      }

      setStatus(`Detected: ${code}`);
      onDetected(code);
      onClose();
    } catch (error) {
      console.error("Image scan failed:", error);
      setStatus("Could not scan that image.");
    }
  };

  const handleManualSubmit = () => {
    const normalized = manualCode.trim();
    if (!normalized) {
      setStatus("Enter QR or barcode value first.");
      return;
    }

    setStatus(`Detected: ${normalized}`);
    onDetected(normalized);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.6)",
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        padding: "20px"
      }}
    >
      <div className="soft-panel" style={{ width: "min(720px, 96vw)", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
          <div>
            <div className="eyebrow">Scanner</div>
            <h2 style={{ marginBottom: "6px" }}>Scan product QR or barcode</h2>
            <p className="muted-copy">{status}</p>
          </div>
          <button type="button" className="header-link" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ marginTop: "18px", display: "grid", gap: "16px" }}>
          {supportsDetector ? (
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: "100%",
                minHeight: "280px",
                background: "#0f172a",
                borderRadius: "18px",
                objectFit: "cover"
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                minHeight: "220px",
                borderRadius: "18px",
                border: "1px dashed rgba(148, 163, 184, 0.45)",
                background: "linear-gradient(180deg, rgba(248, 250, 252, 0.92), rgba(226, 232, 240, 0.82))",
                display: "grid",
                placeItems: "center",
                padding: "24px",
                textAlign: "center",
                color: "#334155",
                fontWeight: 600
              }}
            >
              This browser cannot open the live scanner.
              <br />
              Paste or type the barcode / QR value below.
            </div>
          )}

          <div style={{ display: "grid", gap: "10px" }}>
            <label style={{ display: "grid", gap: "8px" }}>
              <span className="identity-label">Barcode / QR value</span>
              <input
                type="text"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Type or paste scanned code"
              />
            </label>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button type="button" className="primary-button" onClick={handleManualSubmit}>
                Use This Code
              </button>
              <button type="button" className="header-link" onClick={() => fileInputRef.current?.click()}>
                Scan From Image
              </button>
              <button type="button" className="header-link" onClick={onClose}>
                Close
              </button>
            </div>
          </div>

        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleImageScan}
        />
      </div>
    </div>
  );
}

export default ProductScannerModal;
