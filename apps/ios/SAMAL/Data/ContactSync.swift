import Contacts

struct BookContact {
    var phone: String
    var name: String
}

enum ContactSync {
    static func load() async -> [BookContact] {
        let store = CNContactStore()
        let granted: Bool = await withCheckedContinuation { cont in
            store.requestAccess(for: .contacts) { ok, _ in
                cont.resume(returning: ok)
            }
        }
        guard granted else { return [] }
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
        ]
        let req = CNContactFetchRequest(keysToFetch: keys)
        var items: [BookContact] = []
        try? store.enumerateContacts(with: req) { contact, _ in
            let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
            for num in contact.phoneNumbers {
                items.append(BookContact(phone: num.value.stringValue, name: name))
            }
        }
        return items
    }
}

func needsDisplayName(_ name: String?) -> Bool {
    let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if n.isEmpty || n == "TooApp" || n == "Salam" { return true }
    if n.range(of: #"^[•·.\-\s]*\d{2,8}$"#, options: .regularExpression) != nil { return true }
    if n.rangeOfCharacter(from: .letters) == nil { return true }
    return false
}
