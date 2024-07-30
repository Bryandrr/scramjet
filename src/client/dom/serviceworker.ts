import { encodeUrl } from "../../shared/rewriters/url";
import { ScramjetClient } from "../client";

export default function (client: ScramjetClient, self: Self) {
	let fakeregistrations = new WeakSet();

	client.Proxy("Worklet.prototype.addModule", {
		apply(ctx) {
			ctx.args[0] = encodeUrl(ctx.args[0]);
		},
	});

	client.Proxy("addEventListener", {
		apply(ctx) {
			if (fakeregistrations.has(ctx.this)) {
				// do nothing
				ctx.return(undefined);
			}
		},
	});

	client.Proxy("removeEventListener", {
		apply(ctx) {
			if (fakeregistrations.has(ctx.this)) {
				// do nothing
				ctx.return(undefined);
			}
		},
	});

	client.Proxy("navigator.serviceWorker.register", {
		apply(ctx) {
			if (ctx.args[0] instanceof URL) ctx.args[0] = ctx.args[0].href;
			let url = encodeUrl(ctx.args[0]) + "?dest=serviceworker";
			if (ctx.args[1] && ctx.args[1].type === "module") {
				url += "&type=module";
			}
			let worker = new SharedWorker(url);

			let handle = worker.port;

			navigator.serviceWorker.controller.postMessage(
				{
					scramjet$type: "registerServiceWorker",
					port: handle,
				},
				[handle]
			);

			const fakeRegistration = new Proxy(
				{
					__proto__: ServiceWorkerRegistration.prototype,
				},
				{
					get(target, prop) {
						if (prop === "installing") {
							return null;
						}
						if (prop === "waiting") {
							return null;
						}
						if (prop === "active") {
							return handle;
						}
						if (prop === "scope") {
							return ctx.args[0];
						}

						if (prop === "addEventListener") {
							return () => {};
						}

						return Reflect.get(target, prop);
					},
				}
			);
			fakeregistrations.add(fakeRegistration);

			ctx.return(new Promise((resolve) => resolve(fakeRegistration)));
		},
	});

	// delete self.navigator.serviceWorker;
}