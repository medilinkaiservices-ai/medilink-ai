const CONTACTS_KEY = "medilinkSyncedContacts";

export function getSyncedContacts() {
  try {
    return JSON.parse(localStorage.getItem(CONTACTS_KEY)) || [];
  } catch (error) {
    console.error("Unable to read synced contacts", error);
    return [];
  }
}

export function saveSyncedContacts(contacts) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function mergeSyncedContacts(nextContacts = []) {
  const existing = getSyncedContacts();
  const merged = [...existing];

  nextContacts.forEach((contact) => {
    const phone = String(contact.phone || "").trim();
    if (!phone) return;

    const index = merged.findIndex((item) => String(item.phone || "").trim() === phone);
    const normalized = {
      name: String(contact.name || phone).trim(),
      phone,
      role: String(contact.role || "contact").trim()
    };

    if (index >= 0) {
      merged[index] = { ...merged[index], ...normalized };
    } else {
      merged.push(normalized);
    }
  });

  saveSyncedContacts(merged);
  return merged;
}
