export function diffLinks(before, after) {
  const old = new Map(before.map(x => [String(x.id), x]));
  const next = new Map(after.map(x => [String(x.id), x]));
  return {
    upsert: after.filter(x => JSON.stringify(old.get(String(x.id))) !== JSON.stringify(x)),
    remove: [...old.keys()].filter(id => !next.has(id))
  };
}
export function applyChanges(links, changes) {
  const map = new Map(links.map(x => [String(x.id), x]));
  for (const change of changes) {
    for (const id of change.remove) map.delete(String(id));
    for (const link of change.upsert) map.set(String(link.id), link);
  }
  return [...map.values()];
}
