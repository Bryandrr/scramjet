import { iswindow } from ".";
import { ScramjetFrame } from "../controller/frame";
import { SCRAMJETCLIENT, SCRAMJETFRAME } from "../symbols";
import { createDocumentProxy } from "./document";
import { createGlobalProxy } from "./global";
import { getOwnPropertyDescriptorHandler } from "./helpers";
import { createLocationProxy } from "./location";
import { nativeGetOwnPropertyDescriptor } from "./natives";
import { CookieStore, config, decodeUrl, encodeUrl } from "../shared";
import { createWrapFn } from "./shared/wrap";

declare global {
	interface Window {
		$s: any;
		$tryset: any;
		$sImport: any;
	}
}

//eslint-disable-next-line
export type AnyFunction = Function;

export type ProxyCtx = {
	fn: AnyFunction;
	this: any;
	args: any[];
	newTarget: AnyFunction;
	return: (r: any) => void;
};
export type Proxy = {
	construct?(ctx: ProxyCtx): any;
	apply?(ctx: ProxyCtx): any;
};

export type TrapCtx<T> = {
	this: any;
	get: () => T;
	set: (v: T) => void;
};
export type Trap<T> = {
	writable?: boolean;
	value?: any;
	enumerable?: boolean;
	configurable?: boolean;
	get?: (ctx: TrapCtx<T>) => T;
	set?: (ctx: TrapCtx<T>, v: T) => void;
};

export class ScramjetClient {
	documentProxy: any;
	globalProxy: any;
	locationProxy: any;
	serviceWorker: ServiceWorkerContainer;

	descriptors: Record<string, PropertyDescriptor> = {};
	natives: Record<string, any> = {};
	wrapfn: (i: any, ...args: any) => any;

	cookieStore = new CookieStore();

	eventcallbacks: Map<
		any,
		[
			{
				event: string;
				originalCallback: AnyFunction;
				proxiedCallback: AnyFunction;
			},
		]
	> = new Map();

	constructor(public global: typeof globalThis) {
		this.serviceWorker = this.global.navigator.serviceWorker;

		if (iswindow) {
			this.documentProxy = createDocumentProxy(this, global);

			global.document[SCRAMJETCLIENT] = this;
		}

		this.locationProxy = createLocationProxy(this, global);
		this.globalProxy = createGlobalProxy(this, global);
		this.wrapfn = createWrapFn(this, global);

		global[SCRAMJETCLIENT] = this;
	}

	get frame(): ScramjetFrame | null {
		if (!iswindow) return null;
		const frame = this.global.window.frameElement;

		if (!frame) return null; // we're top level
		const sframe = frame[SCRAMJETFRAME];

		if (!sframe) return null; // we're a subframe. TODO handle propagation but not now

		return sframe;
	}

	loadcookies(cookiestr: string) {
		this.cookieStore.load(cookiestr);
	}

	hook() {
		// @ts-ignore
		const context = import.meta.webpackContext(".", {
			recursive: true,
		});

		const modules = [];

		for (const key of context.keys()) {
			const module = context(key);
			if (!key.endsWith(".ts")) continue;
			if (
				(key.startsWith("./dom/") && "window" in self) ||
				(key.startsWith("./worker/") && "WorkerGlobalScope" in self) ||
				key.startsWith("./shared/")
			) {
				modules.push(module);
			}
		}

		modules.sort((a, b) => {
			const aorder = a.order || 0;
			const border = b.order || 0;

			return aorder - border;
		});

		for (const module of modules) {
			if (!module.enabled || module.enabled())
				module.default(this, this.global);
			else module.disabled(this, this.global);
		}
	}

	get url(): URL {
		return new URL(decodeUrl(self.location.href));
	}

	set url(url: URL | string) {
		if (typeof url === "string") url = new URL(url);

		self.location.href = encodeUrl(url.href);
	}

	// below are the utilities for proxying and trapping dom APIs
	// you don't have to understand this it just makes the rest easier
	// i'll document it eventually

	Proxy(name: string | string[], handler: Proxy) {
		if (Array.isArray(name)) {
			for (const n of name) {
				this.Proxy(n, handler);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);
		const original = Reflect.get(target, prop);
		this.natives[name] = original;

		this.RawProxy(target, prop, handler);
	}
	RawProxy(target: any, prop: string, handler: Proxy) {
		if (!target) return;
		if (!prop) return;
		if (!Reflect.has(target, prop)) return;

		const value = Reflect.get(target, prop);
		delete target[prop];

		const h: ProxyHandler<any> = {};

		if (handler.construct) {
			h.construct = function (
				constructor: any,
				argArray: any[],
				newTarget: AnyFunction
			) {
				let returnValue: any = null;

				const ctx: ProxyCtx = {
					fn: constructor,
					this: null,
					args: argArray,
					newTarget: newTarget,
					return: (r: any) => {
						returnValue = r;
					},
				};

				handler.construct(ctx);

				if (returnValue) {
					return returnValue;
				}

				return Reflect.construct(ctx.fn, ctx.args, ctx.newTarget);
			};
		}

		if (handler.apply) {
			h.apply = function (fn: any, thisArg: any, argArray: any[]) {
				let returnValue: any = null;
				let earlyreturn = false;

				const ctx: ProxyCtx = {
					fn,
					this: thisArg,
					args: argArray,
					newTarget: null,
					return: (r: any) => {
						earlyreturn = true;
						returnValue = r;
					},
				};

				const pst = Error.prepareStackTrace;

				Error.prepareStackTrace = function (err, s) {
					if (
						s[0].getFileName() &&
						!s[0].getFileName().startsWith(location.origin + config.prefix)
					) {
						return { stack: err.stack };
					}
				};

				try {
					handler.apply(ctx);
				} catch (err) {
					if (err instanceof Error) {
						if ((err.stack as any) instanceof Object) {
							//@ts-expect-error i'm not going to explain this
							err.stack = err.stack.stack;
							console.error("ERROR FROM SCRMAJET INTERNALS", err);
						} else {
							throw err;
						}
					} else {
						throw err;
					}
				}

				delete Error.prepareStackTrace;

				if (earlyreturn) {
					return returnValue;
				}

				return Reflect.apply(ctx.fn, ctx.this, ctx.args);
			};
		}

		h.getOwnPropertyDescriptor = getOwnPropertyDescriptorHandler;
		target[prop] = new Proxy(value, h);
	}
	Trap<T>(name: string | string[], descriptor: Trap<T>): PropertyDescriptor {
		if (Array.isArray(name)) {
			for (const n of name) {
				this.Trap(n, descriptor);
			}

			return;
		}

		const split = name.split(".");
		const prop = split.pop();
		const target = split.reduce((a, b) => a?.[b], this.global);

		const original = nativeGetOwnPropertyDescriptor(target, prop);
		this.descriptors[name] = original;

		return this.RawTrap(target, prop, descriptor);
	}
	RawTrap<T>(
		target: any,
		prop: string,
		descriptor: Trap<T>
	): PropertyDescriptor {
		if (!target) return;
		if (!prop) return;
		if (!Reflect.has(target, prop)) return;

		const oldDescriptor = nativeGetOwnPropertyDescriptor(target, prop);

		const ctx: TrapCtx<T> = {
			this: null,
			get: function () {
				return oldDescriptor && oldDescriptor.get.call(this.this);
			},
			set: function (v: T) {
				oldDescriptor && oldDescriptor.set.call(this.this, v);
			},
		};

		delete target[prop];

		const desc: PropertyDescriptor = {};

		if (descriptor.get) {
			desc.get = function () {
				ctx.this = this;

				return descriptor.get(ctx);
			};
		} else if (oldDescriptor?.get) {
			desc.get = oldDescriptor.get;
		}

		if (descriptor.set) {
			desc.set = function (v: T) {
				ctx.this = this;

				descriptor.set(ctx, v);
			};
		} else if (oldDescriptor?.set) {
			desc.set = oldDescriptor.set;
		}

		if (descriptor.enumerable) desc.enumerable = descriptor.enumerable;
		else if (oldDescriptor?.enumerable)
			desc.enumerable = oldDescriptor.enumerable;
		if (descriptor.configurable) desc.configurable = descriptor.configurable;
		else if (oldDescriptor?.configurable)
			desc.configurable = oldDescriptor.configurable;

		Object.defineProperty(target, prop, desc);

		return oldDescriptor;
	}
}
