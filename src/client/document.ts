import { encodeUrl } from "../shared/rewriters/url";
import { ScramjetClient } from "./client";

export function createDocumentProxy(
	client: ScramjetClient,
	self: typeof globalThis
) {
	return new Proxy(self.document, {
		get(target, prop) {
			if (prop === "location") {
				return client.locationProxy;
			}

			if (prop === "defaultView") {
				return client.globalProxy;
			}

			const value = Reflect.get(target, prop);
			return value;
		},
		set(target, prop, newValue) {
			if (prop === "location") {
				location.href = encodeUrl(newValue);
				return;
			}

			return Reflect.set(target, prop, newValue);
		},
	});
}
