const ACCOUNT_KEY = "medilinkAccount";
const CUSTOMER_KEY = "medilinkCustomerProfile";
const SELLER_KEY = "medilinkSellerProfile";
const HOSPITAL_KEY = "medilinkHospitalProfile";
const PUBLIC_KEY = "medilinkPublicProfile";
const LAWYER_KEY = "medilinkLawyerProfile";
const DEV_BYPASS_ENABLED = true;

function getProfileStorageKey(role) {
  if (role === "seller") return SELLER_KEY;
  if (role === "hospital") return HOSPITAL_KEY;
  if (role === "public") return PUBLIC_KEY;
  if (role === "lawyer") return LAWYER_KEY;
  return CUSTOMER_KEY;
}

export function getStoredAccount() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) || null;
  } catch (error) {
    console.error("Unable to read account from storage", error);
    return null;
  }
}

export function saveStoredAccount(account) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function mergeStoredAccount(patch) {
  const account = getStoredAccount();

  if (!account) return null;

  const nextAccount = {
    ...account,
    ...patch
  };

  saveStoredAccount(nextAccount);
  return nextAccount;
}

export function getStoredProfile(role) {
  const key = getProfileStorageKey(role);

  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch (error) {
    console.error(`Unable to read ${role} profile`, error);
    return null;
  }
}

export function saveStoredProfile(role, profile) {
  const key = getProfileStorageKey(role);
  localStorage.setItem(key, JSON.stringify(profile));
}

export function registerRole(role, profile) {
  const existingAccount = getStoredAccount();
  const existingRoles = existingAccount?.roles || [];
  const mergedRoles = existingRoles.includes(role)
    ? existingRoles
    : [...existingRoles, role];

  const account = {
    uid: existingAccount?.uid || profile.uid || "",
    phone: existingAccount?.phone || profile.phone,
    name: existingAccount?.name || profile.name,
    roles: mergedRoles,
    lastActiveRole: role,
    authProvider: existingAccount?.authProvider || profile.authProvider || "local",
    otpVerified: existingAccount?.otpVerified || Boolean(profile.otpVerified)
  };

  saveStoredAccount(account);
  saveStoredProfile(role, profile);

  return account;
}

export function setLastActiveRole(role) {
  const account = getStoredAccount();

  if (!account) return;

  saveStoredAccount({
    ...account,
    lastActiveRole: role
  });
}

export function activateDevelopmentRole(role, profile) {
  const existingAccount = getStoredAccount();
  const existingRoles = existingAccount?.roles || [];
  const nextRoles = existingRoles.includes(role)
    ? existingRoles
    : [...existingRoles, role];

  const nextAccount = {
    uid: existingAccount?.uid || profile.uid || "",
    phone: existingAccount?.phone || profile.phone || "",
    name: existingAccount?.name || profile.name || profile.shopName || profile.hospitalName || "",
    roles: nextRoles,
    lastActiveRole: role,
    authProvider: existingAccount?.authProvider || profile.authProvider || "local",
    otpVerified: existingAccount?.otpVerified || Boolean(profile.otpVerified)
  };

  saveStoredAccount(nextAccount);
  saveStoredProfile(role, profile);

  return nextAccount;
}

export function isDevelopmentBypassEnabled() {
  return DEV_BYPASS_ENABLED;
}

export function saveAuthenticatedAccount(account) {
  const existingAccount = getStoredAccount();
  const nextAccount = {
    uid: account.uid || existingAccount?.uid || "",
    phone: account.phone || existingAccount?.phone || "",
    name: account.name || existingAccount?.name || "",
    roles: account.roles || existingAccount?.roles || [],
    lastActiveRole: account.lastActiveRole || existingAccount?.lastActiveRole || "",
    authProvider: account.authProvider || "phone",
    otpVerified: account.otpVerified ?? true
  };

  saveStoredAccount(nextAccount);
  return nextAccount;
}

export function getRoleHomePath(role) {
  if (role === "seller") return "/seller/dashboard";
  if (role === "hospital") return "/hospital/dashboard";
  if (role === "lawyer") return "/law-assistant?mode=lawyer";
  if (role === "public") return "/law-assistant?mode=public";
  return "/customer/account";
}

export function getPostLoginPath(account) {
  if (!account?.roles?.length) return "/register/customer";
  if (account.lastActiveRole && account.roles.includes(account.lastActiveRole)) {
    return getRoleHomePath(account.lastActiveRole);
  }
  if (account.roles.length === 1) {
    return getRoleHomePath(account.roles[0]);
  }
  return "/role-select";
}

export function clearStoredSession() {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
  localStorage.removeItem(SELLER_KEY);
  localStorage.removeItem(HOSPITAL_KEY);
  localStorage.removeItem(PUBLIC_KEY);
  localStorage.removeItem(LAWYER_KEY);
}

export function ensureDevelopmentSession() {
  if (!DEV_BYPASS_ENABLED) {
    return getStoredAccount();
  }

  const existingAccount = getStoredAccount();
  const seededAccount = existingAccount || {
    uid: "dev-medilink-user",
    phone: "9999999999",
    name: "Dev User",
    roles: ["customer", "seller", "hospital", "public", "lawyer"],
    lastActiveRole: "customer",
    authProvider: "development",
    otpVerified: true
  };

  saveStoredAccount({
    ...seededAccount,
    roles: seededAccount.roles?.length ? seededAccount.roles : ["customer", "seller", "hospital", "public", "lawyer"],
    lastActiveRole: seededAccount.lastActiveRole || "customer",
    otpVerified: true
  });

  if (!getStoredProfile("customer")) {
    saveStoredProfile("customer", {
      uid: seededAccount.uid,
      name: seededAccount.name || "Dev User",
      phone: seededAccount.phone || "9999999999",
      area: "Development"
    });
  }

  if (!getStoredProfile("seller")) {
    saveStoredProfile("seller", {
      uid: seededAccount.uid,
      shopId: "dev-shop",
      shopName: "Dev Medilink Store",
      name: seededAccount.name || "Dev Seller",
      phone: seededAccount.phone || "9999999999",
      city: "Development",
      categoryId: "general",
      description: "Development seller profile"
    });
  }

  if (!getStoredProfile("hospital")) {
    saveStoredProfile("hospital", {
      uid: seededAccount.uid,
      hospitalId: "dev-hospital",
      hospitalName: "Dev Medilink Hospital",
      name: seededAccount.name || "Dev Hospital",
      phone: seededAccount.phone || "9999999999",
      city: "Development",
      departments: ["General"],
      about: "Development hospital profile"
    });
  }

  if (!getStoredProfile("public")) {
    saveStoredProfile("public", {
      uid: seededAccount.uid,
      name: seededAccount.name || "Dev Public User",
      phone: seededAccount.phone || "9999999999",
      location: "Development"
    });
  }

  if (!getStoredProfile("lawyer")) {
    saveStoredProfile("lawyer", {
      uid: seededAccount.uid,
      name: seededAccount.name || "Dev Lawyer",
      phone: seededAccount.phone || "9999999999",
      barCouncilId: "DEV-BAR-0001"
    });
  }

  return getStoredAccount();
}
