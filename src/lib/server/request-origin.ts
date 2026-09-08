export function mutationIsSameOrigin(request: Request, expectedOrigin: string): boolean {
	const origin = request.headers.get('origin');
	return !origin || origin === expectedOrigin;
}
