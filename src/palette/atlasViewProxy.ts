/**
 * Atlas's map view as the board's command palette reads it, with the board's own answers for what would change Atlas's
 * window. Methods are called on Atlas's view; what a getter gives (Atlas's `atlasStore`, a zustand store: a function that
 * carries getState and subscribe) is handed over as it is, since binding it would make a bare function without them.
 */
export function atlasViewFor(atlas: object, own: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(atlas as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === 'string' && key in own) return own[key];
      const member = Reflect.get(target, key);
      if (typeof member !== 'function' || isGetter(target, key)) return member;
      return member.bind(target);
    },
  });
}

/** Whether a property is read through a getter (on the object or up its prototype chain). */
function isGetter(target: object, key: PropertyKey): boolean {
  for (let at: object | null = target; at; at = Object.getPrototypeOf(at)) {
    const described = Object.getOwnPropertyDescriptor(at, key);
    if (described) return described.get !== undefined;
  }
  return false;
}
