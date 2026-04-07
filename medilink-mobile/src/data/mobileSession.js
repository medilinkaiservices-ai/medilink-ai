export const seededAccount = {
  uid: "local-medilink-user",
  phone: "9999999999",
  name: "Lead Counsel",
  roles: ["lawyer", "public", "senior", "firm"],
  lastActiveRole: "lawyer",
  authProvider: "local",
  otpVerified: true
};

export const seededLawyerProfile = {
  uid: "local-medilink-user",
  name: "Lead Counsel",
  phone: "9999999999",
  barCouncilId: "BAR-0001"
};

export function getDisplayName() {
  return seededLawyerProfile.name || seededAccount.name || "Medilink User";
}
