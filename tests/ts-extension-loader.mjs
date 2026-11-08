// Test-only Node ESM loader: Vite resolves extensionless TypeScript imports,
// but Node's built-in type stripping does not resolve them automatically.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
    return nextResolve(specifier + '.ts', context)
  }
}
