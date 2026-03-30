import React from "react";
import SellerShell from "../components/SellerShell";
import QRCodeManager from "../components/QRCodeManager";

function SellerQRCodePage() {
  return (
    <SellerShell
      title="Seller QR"
      subtitle="Generate, download and share your seller public QR from one place."
    >
      <section className="soft-panel hospital-dashboard-qr">
        <div className="hospital-public-card-head">
          <div>
            <div className="eyebrow">Seller QR</div>
            <h3>Generate and share seller QR</h3>
          </div>
        </div>
        <QRCodeManager />
      </section>
    </SellerShell>
  );
}

export default SellerQRCodePage;
