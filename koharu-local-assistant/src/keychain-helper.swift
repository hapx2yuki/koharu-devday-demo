import Foundation
import Security
import Darwin

let service = "jp.koharu.local-assistant.credentials"
let maximumValueBytes = 200_000

func finish(_ status: OSStatus) -> Never {
    print(status)
    exit(status == errSecSuccess ? EXIT_SUCCESS : EXIT_FAILURE)
}

func readValue() throws -> Data {
    var value = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: 8192), !chunk.isEmpty {
        value.append(chunk)
        if value.count > maximumValueBytes { finish(errSecParam) }
    }
    guard !value.isEmpty,
          let encoded = String(data: value, encoding: .ascii),
          let decoded = Data(base64Encoded: encoded),
          decoded.base64EncodedString() == encoded else { finish(errSecParam) }
    return value
}

guard CommandLine.arguments.count == 3 else { finish(errSecParam) }
let operation = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
guard ["set", "get", "delete"].contains(operation),
      account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { finish(errSecParam) }

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
    kSecAttrSynchronizable as String: false,
]

do {
    switch operation {
    case "set":
        let value = try readValue()
        var attributes = query
        attributes[kSecValueData as String] = value
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            finish(SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary))
        }
        finish(status)
    case "get":
        var attributes = query
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        guard status == errSecSuccess else { finish(status) }
        guard let value = result as? Data, value.count <= maximumValueBytes else { finish(errSecDecode) }
        // Descriptor 3 is an anonymous pipe owned by the parent. stdout is status only.
        let secretPipe = FileHandle(fileDescriptor: 3, closeOnDealloc: false)
        try secretPipe.write(contentsOf: value)
        finish(errSecSuccess)
    case "delete":
        finish(SecItemDelete(query as CFDictionary))
    default:
        finish(errSecParam)
    }
} catch {
    finish(errSecIO)
}
