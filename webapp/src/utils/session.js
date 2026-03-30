const ACCOUNT_KEY = "medilinkAccount";
const CUSTOMER_KEY = "medilinkCustomerProfile";
const SELLER_KEY = "medilinkSellerProfile";
const HOSPITAL_KEY = "medilinkHospitalProfile";

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
  const key =
    role === "seller"
      ? SELLER_KEY
      : role === "hospital"
        ? HOSPITAL_KEY
        : CUSTOMER_KEY;

  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch (error) {
    console.error(`Unable to read ${role} profile`, error);
    return null;
  }
}

export function saveStoredProfile(role, profile) {
  const key =
    role === "seller"
      ? SELLER_KEY
      : role === "hospital"
        ? HOSPITAL_KEY
        : CUSTOMER_KEY;
  localStorage.setItem(key, JSON.stringify(profile));
}

export function registerRole(role, profile) {
  const existingAccount = getStoredAccount();
  const existingRoles = existingAccount?.roles || [];
  const mergedRoles = existingRoles.includes(role)
    ? existingRoles
    : [...existingRoles, role];

  const account = {
    phone: profile.phone,
    name: profile.name,
    roles: mergedRoles,
    lastActiveRole: role
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
    phone: existingAccount?.phone || profile.phone || "",
    name: existingAccount?.name || profile.name || profile.shopName || profile.hospitalName || "",
    roles: nextRoles,
    lastActiveRole: role
  };

  saveStoredAccount(nextAccount);
  saveStoredProfile(role, profile);

  return nextAccount;
}
