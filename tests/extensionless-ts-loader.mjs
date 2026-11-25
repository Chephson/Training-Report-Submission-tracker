// Test-only resolver for the project's extensionless relative TypeScript imports.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
    try { return await nextResolve(specifier + '.ts', context) } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  return nextResolve(specifier, context)
}
