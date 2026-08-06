import type { Doc, Printer } from 'prettier';
import { doc } from 'prettier';
import { printers as estreePrinters } from 'prettier/plugins/estree';

type AttachedComment = {
	leading?: boolean;
	trailing?: boolean;
};

type JSONContainerType = 'array' | 'object';

function hasDanglingComments(node: unknown): boolean {
	const { comments } = node as { comments?: AttachedComment[] };
	return (
		comments?.some(({ leading, trailing }) => !leading && !trailing) ===
		true
	);
}

function getNonEmptyJSONContainerType(
	node: unknown
): JSONContainerType | undefined {
	/* v8 ignore if -- @preserve */
	if (typeof node !== 'object' || node === null || !('type' in node)) {
		return undefined;
	}

	const hasContents = hasDanglingComments(node);

	switch (node.type) {
		case 'ArrayExpression':
			return (node as unknown as { elements: unknown[] }).elements
				.length > 0 || hasContents
				? 'array'
				: undefined;

		case 'ObjectExpression':
			return (node as unknown as { properties: unknown[] }).properties
				.length > 0 || hasContents
				? 'object'
				: undefined;

		default:
			return undefined;
	}
}

function unpackFill(currentDoc: Doc): Doc {
	return typeof currentDoc !== 'string' &&
		!Array.isArray(currentDoc) &&
		currentDoc.type === 'fill'
		? currentDoc.parts
		: currentDoc;
}

function forceDirectGroupToBreak(currentDoc: Doc): Doc {
	return typeof currentDoc !== 'string' &&
		!Array.isArray(currentDoc) &&
		currentDoc.type === 'group'
		? { ...currentDoc, break: true }
		: currentDoc;
}

function forceNativeContainerGroupToBreak(
	printed: Doc,
	containerType: JSONContainerType
): Doc {
	let structuralGroup: Doc | undefined = printed;

	if (Array.isArray(printed)) {
		[structuralGroup] = printed;
	}

	/* v8 ignore if -- @preserve */
	if (
		typeof structuralGroup !== 'object' ||
		structuralGroup === null ||
		Array.isArray(structuralGroup) ||
		structuralGroup.type !== 'group'
	) {
		return printed;
	}

	const contents =
		containerType === 'array'
			? doc.utils.mapDoc(structuralGroup.contents, unpackFill)
			: forceDirectGroupToBreak(structuralGroup.contents);

	const brokenGroup = { ...structuralGroup, break: true, contents };

	return Array.isArray(printed)
		? [brokenGroup, ...printed.slice(1)]
		: brokenGroup;
}

const printExpandedJSON: Printer['print'] = (path, options, print, args) => {
	const containerType = getNonEmptyJSONContainerType(path.node);
	const printed = estreePrinters.estree.print(path, options, print, args);

	return containerType
		? forceNativeContainerGroupToBreak(printed, containerType)
		: printed;
};

export default printExpandedJSON;
