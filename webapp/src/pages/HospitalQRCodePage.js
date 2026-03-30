import React from "react";
import HospitalShell from "../components/HospitalShell";
import QRCodeManager from "../components/QRCodeManager";

function HospitalQRCodePage() {
  return (
    <HospitalShell
      title="Hospital QR"
      subtitle="Generate, download and share your hospital public QR from one place."
    >
      <section className="soft-panel hospital-dashboard-qr">
        <div className="hospital-public-card-head">
          <div>
            <div className="eyebrow">Hospital QR</div>
            <h3>Generate and share hospital QR</h3>
          </div>
        </div>
        <QRCodeManager />
      </section>
    </HospitalShell>
  );
}

export default HospitalQRCodePage;
