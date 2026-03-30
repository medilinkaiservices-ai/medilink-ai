import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

/* HEADER */
import Header from "./components/Header";

/* MAIN PAGES */
import MarketplaceHome from "./pages/MarketplaceHome";
import ShopPage from "./pages/ShopPage";
import SearchPage from "./pages/SearchPage";
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
import HospitalsPage from "./pages/HospitalsPage";
import HospitalPublicProfile from "./pages/HospitalPublicProfile";
import HospitalAppointmentBooking from "./pages/HospitalAppointmentBooking";
import HospitalAccess from "./pages/HospitalAccess";
import HospitalInbox from "./pages/HospitalInbox";
import ChatInbox from "./pages/ChatInbox";
import ConsultationRoom from "./pages/ConsultationRoom";

/* SELLER */
import SellerRegistration from "./pages/SellerRegistration";
import ProductEntry from "./pages/ProductEntry";
import ProductUpdate from "./pages/ProductUpdate";
import SellerOrders from "./pages/SellerOrders";
import SellerDashboard from "./pages/SellerDashboard";
import SellerShopProfile from "./pages/SellerShopProfile";
import SellerProducts from "./pages/SellerProducts";
import SellerOffers from "./pages/SellerOffers";
import SellerAnalytics from "./pages/SellerAnalytics";
import SellerSettings from "./pages/SellerSettings";
import SellerInbox from "./pages/SellerInbox";
import SellerAccess from "./pages/SellerAccess";

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
    <Router>

      {/* HEADER */}
      <Header />
      <ChatLauncher />

      <Routes>

        {/* MAIN */}
        <Route path="/" element={<MarketplaceHome />} />
        <Route path="/shop/:shopId" element={<ShopPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/register/customer" element={<CustomerRegistration />} />
        <Route path="/customer/account" element={<CustomerAccount />} />
        <Route path="/customer/appointments" element={<CustomerAppointments />} />
        <Route path="/customer/notifications" element={<CustomerNotifications />} />
        <Route path="/register/hospital" element={<HospitalRegistration />} />
        <Route path="/hospital/dashboard" element={<HospitalDashboard />} />
        <Route path="/hospital/access" element={<HospitalAccess />} />
        <Route path="/hospital/inbox" element={<HospitalInbox />} />
        <Route path="/hospital/inbox/:roomId" element={<HospitalInbox />} />
        <Route path="/hospital/profile" element={<HospitalProfile />} />
        <Route path="/hospital/doctors" element={<HospitalDoctors />} />
        <Route path="/hospital/services" element={<HospitalServices />} />
        <Route path="/hospital/appointments" element={<HospitalAppointments />} />
        <Route path="/hospitals" element={<HospitalsPage />} />
        <Route path="/hospitals/:hospitalId" element={<HospitalPublicProfile />} />
        <Route path="/hospitals/:hospitalId/book" element={<HospitalAppointmentBooking />} />
        <Route path="/connect" element={<ChatInbox />} />
        <Route path="/connect/:roomId" element={<ChatInbox />} />
        <Route path="/consult/:callId" element={<ConsultationRoom />} />

        {/* SELLER */}
        <Route path="/seller-registration" element={<SellerRegistration />} />
        <Route path="/register/seller" element={<SellerRegistration />} />
        <Route path="/seller/dashboard" element={<SellerDashboard />} />
        <Route path="/seller/access" element={<SellerAccess />} />
        <Route path="/seller/inbox" element={<SellerInbox />} />
        <Route path="/seller/inbox/:roomId" element={<SellerInbox />} />
        <Route path="/seller/shop-profile" element={<SellerShopProfile />} />
        <Route path="/seller/products" element={<SellerProducts />} />
        <Route path="/seller/offers" element={<SellerOffers />} />
        <Route path="/seller/analytics" element={<SellerAnalytics />} />
        <Route path="/seller/settings" element={<SellerSettings />} />
        <Route path="/product-entry" element={<ProductEntry />} />
        <Route path="/product-update" element={<ProductUpdate />} />
        <Route path="/seller-orders" element={<SellerOrders />} />

        {/* KHATHA */}
        <Route path="/khatha-billing" element={<KhathaBilling />} />
        <Route path="/khatha-history" element={<KhathaHistory />} />

        {/* AFFILIATE */}
        <Route path="/affiliate" element={<AffiliateDashboard />} />
<Route path="/leaderboard" element={<AffiliateLeaderboard />} />
<Route path="/analytics" element={<AffiliateAnalytics />} />

        {/* CART */}
        <Route path="/cart" element={<CartPage />} />

      </Routes>

    </Router>
  );
}

export default App;
