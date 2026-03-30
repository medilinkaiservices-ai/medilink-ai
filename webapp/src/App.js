import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

/* HEADER */
import Header from "./components/Header";
import RequireAuth from "./components/RequireAuth";
import RequireRole from "./components/RequireRole";

/* MAIN PAGES */
import MarketplaceHome from "./pages/MarketplaceHome";
import ShopPage from "./pages/ShopPage";
import SearchWorkspacePage from "./pages/SearchWorkspacePage";
import LawAssistantPage from "./pages/LawAssistantPage";
import PhoneLogin from "./pages/PhoneLogin";
import RoleSelect from "./pages/RoleSelect";
import CustomerRegistration from "./pages/CustomerRegistration";
import CustomerAccount from "./pages/CustomerAccount";
import CustomerAppointments from "./pages/CustomerAppointments";
import CustomerNotifications from "./pages/CustomerNotifications";
import HospitalRegistration from "./pages/HospitalRegistration";
import HospitalDashboard from "./pages/HospitalDashboard";
import HospitalProfile from "./pages/HospitalProfile";
import HospitalDoctors from "./pages/HospitalDoctors";
import HospitalServices from "./pages/HospitalServices";
import HospitalAppointments from "./pages/HospitalAppointments";
import HospitalQRCodePage from "./pages/HospitalQRCodePage";
import HospitalsPage from "./pages/HospitalsPage";
import HospitalPublicProfile from "./pages/HospitalPublicProfile";
import HospitalAppointmentBooking from "./pages/HospitalAppointmentBooking";
import HospitalAccess from "./pages/HospitalAccess";
import HospitalInbox from "./pages/HospitalInbox";
import ChatInbox from "./pages/ChatInbox";
import ConsultationRoom from "./pages/ConsultationRoom";

/* SELLER */
import SellerRegistration from "./pages/SellerRegistration";
import SellerDashboard from "./pages/SellerDashboard";
import ProductEntry from "./pages/ProductEntry";
import ProductUpdate from "./pages/ProductUpdate";
import SellerOrders from "./pages/SellerOrders";
import SellerShopProfile from "./pages/SellerShopProfile";
import SellerProducts from "./pages/SellerProducts";
import SellerOffers from "./pages/SellerOffers";
import SellerAnalytics from "./pages/SellerAnalytics";
import SellerSettings from "./pages/SellerSettings";
import SellerInbox from "./pages/SellerInbox";
import SellerAccess from "./pages/SellerAccess";
import SellerStockInward from "./pages/SellerStockInward";
import SellerQRCodePage from "./pages/SellerQRCodePage";

/* KHATHA */
import KhathaBilling from "./pages/KhathaBilling";
import KhathaHistory from "./pages/KhathaHistory";

/* AFFILIATE */
import AffiliateDashboard from "./affiliate/AffiliateDashboard";
import AffiliateLeaderboard from "./affiliate/AffiliateLeaderboard";
import AffiliateAnalytics from "./affiliate/AffiliateAnalytics";

/* CART */
import CartPage from "./pages/CartPage";
import ChatLauncher from "./components/ChatLauncher";

function App() {
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >

      {/* HEADER */}
      <Header />
      <ChatLauncher />

      <Routes>

        {/* MAIN */}
        <Route path="/" element={<RequireAuth><MarketplaceHome /></RequireAuth>} />
        <Route path="/login" element={<PhoneLogin />} />
        <Route path="/role-select" element={<RequireAuth><RoleSelect /></RequireAuth>} />
        <Route path="/shop/:shopId" element={<RequireAuth><ShopPage /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth><SearchWorkspacePage /></RequireAuth>} />
        <Route path="/law-assistant" element={<RequireAuth><LawAssistantPage /></RequireAuth>} />
        <Route path="/register/customer" element={<RequireAuth><CustomerRegistration /></RequireAuth>} />
        <Route path="/customer/account" element={<RequireAuth><RequireRole role="customer"><CustomerAccount /></RequireRole></RequireAuth>} />
        <Route path="/customer/appointments" element={<RequireAuth><RequireRole role="customer"><CustomerAppointments /></RequireRole></RequireAuth>} />
        <Route path="/customer/notifications" element={<RequireAuth><RequireRole role="customer"><CustomerNotifications /></RequireRole></RequireAuth>} />
        <Route path="/register/hospital" element={<RequireAuth><HospitalRegistration /></RequireAuth>} />
        <Route path="/hospital/dashboard" element={<RequireAuth><RequireRole role="hospital"><HospitalDashboard /></RequireRole></RequireAuth>} />
        <Route path="/hospital/access" element={<RequireAuth><HospitalAccess /></RequireAuth>} />
        <Route path="/hospital/inbox" element={<RequireAuth><RequireRole role="hospital"><HospitalInbox /></RequireRole></RequireAuth>} />
        <Route path="/hospital/inbox/:roomId" element={<RequireAuth><RequireRole role="hospital"><HospitalInbox /></RequireRole></RequireAuth>} />
        <Route path="/hospital/profile" element={<RequireAuth><RequireRole role="hospital"><HospitalProfile /></RequireRole></RequireAuth>} />
        <Route path="/hospital/doctors" element={<RequireAuth><RequireRole role="hospital"><HospitalDoctors /></RequireRole></RequireAuth>} />
        <Route path="/hospital/services" element={<RequireAuth><RequireRole role="hospital"><HospitalServices /></RequireRole></RequireAuth>} />
        <Route path="/hospital/appointments" element={<RequireAuth><RequireRole role="hospital"><HospitalAppointments /></RequireRole></RequireAuth>} />
        <Route path="/hospital/qr" element={<RequireAuth><RequireRole role="hospital"><HospitalQRCodePage /></RequireRole></RequireAuth>} />
        <Route path="/hospitals" element={<RequireAuth><HospitalsPage /></RequireAuth>} />
        <Route path="/hospitals/:hospitalId" element={<RequireAuth><HospitalPublicProfile /></RequireAuth>} />
        <Route path="/hospitals/:hospitalId/book" element={<RequireAuth><HospitalAppointmentBooking /></RequireAuth>} />
        <Route path="/connect" element={<RequireAuth><ChatInbox /></RequireAuth>} />
        <Route path="/connect/:roomId" element={<RequireAuth><ChatInbox /></RequireAuth>} />
        <Route path="/consult/:callId" element={<RequireAuth><ConsultationRoom /></RequireAuth>} />

        {/* SELLER */}
        <Route path="/seller-registration" element={<RequireAuth><SellerRegistration /></RequireAuth>} />
        <Route path="/register/seller" element={<RequireAuth><SellerRegistration /></RequireAuth>} />
        <Route path="/seller/dashboard" element={<RequireAuth><RequireRole role="seller"><SellerDashboard /></RequireRole></RequireAuth>} />
        <Route path="/seller/access" element={<RequireAuth><SellerAccess /></RequireAuth>} />
        <Route path="/seller/inbox" element={<RequireAuth><RequireRole role="seller"><SellerInbox /></RequireRole></RequireAuth>} />
        <Route path="/seller/inbox/:roomId" element={<RequireAuth><RequireRole role="seller"><SellerInbox /></RequireRole></RequireAuth>} />
        <Route path="/seller/shop-profile" element={<RequireAuth><RequireRole role="seller"><SellerShopProfile /></RequireRole></RequireAuth>} />
        <Route path="/seller/products" element={<RequireAuth><RequireRole role="seller"><SellerProducts /></RequireRole></RequireAuth>} />
        <Route path="/seller/offers" element={<RequireAuth><RequireRole role="seller"><SellerOffers /></RequireRole></RequireAuth>} />
        <Route path="/seller/analytics" element={<RequireAuth><RequireRole role="seller"><SellerAnalytics /></RequireRole></RequireAuth>} />
        <Route path="/seller/settings" element={<RequireAuth><RequireRole role="seller"><SellerSettings /></RequireRole></RequireAuth>} />
        <Route path="/seller/qr" element={<RequireAuth><RequireRole role="seller"><SellerQRCodePage /></RequireRole></RequireAuth>} />
        <Route path="/product-entry" element={<RequireAuth><RequireRole role="seller"><ProductEntry /></RequireRole></RequireAuth>} />
        <Route path="/product-update" element={<RequireAuth><RequireRole role="seller"><ProductUpdate /></RequireRole></RequireAuth>} />
        <Route path="/seller/stock-inward" element={<RequireAuth><RequireRole role="seller"><SellerStockInward /></RequireRole></RequireAuth>} />
        <Route path="/seller-orders" element={<RequireAuth><RequireRole role="seller"><SellerOrders /></RequireRole></RequireAuth>} />

        {/* KHATHA */}
        <Route path="/khatha-billing" element={<RequireAuth><RequireRole role="seller"><KhathaBilling /></RequireRole></RequireAuth>} />
        <Route path="/khatha-history" element={<RequireAuth><RequireRole role="seller"><KhathaHistory /></RequireRole></RequireAuth>} />

        {/* AFFILIATE */}
        <Route path="/affiliate" element={<RequireAuth><AffiliateDashboard /></RequireAuth>} />
<Route path="/leaderboard" element={<RequireAuth><AffiliateLeaderboard /></RequireAuth>} />
<Route path="/analytics" element={<RequireAuth><AffiliateAnalytics /></RequireAuth>} />

        {/* CART */}
        <Route path="/cart" element={<RequireAuth><CartPage /></RequireAuth>} />

      </Routes>

    </Router>
  );
}

export default App;
