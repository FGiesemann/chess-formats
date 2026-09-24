import * as vscode from 'vscode';
import { LanguageValidator } from './common/types';
import { epdValidator } from './epd';
import { pgnValidator } from './pgn';

const validators: LanguageValidator[] = [
	epdValidator,
	pgnValidator,
];

const collections = new Map<string, vscode.DiagnosticCollection>();

function pickValidator(doc: vscode.TextDocument): LanguageValidator | undefined {
	return validators.find(v =>
		v.languageId === doc.languageId ||
		v.extensions.some(ext => doc.fileName.endsWith(ext))
	);
}

function runValidation(doc: vscode.TextDocument) {
	const validator = pickValidator(doc);
	if (!validator) { return; }

	let collection = collections.get(validator.languageId);
	if (!collection) {
		collection = vscode.languages.createDiagnosticCollection(validator.languageId);
		collections.set(validator.languageId, collection);
	}

	const diagnostics = validator.validate(doc);
	collection.set(doc.uri, diagnostics);
}

export function activate(context: vscode.ExtensionContext) {
	for (const c of collections.values()) { context.subscriptions.push(c); }

	if (vscode.window.activeTextEditor) {
		runValidation(vscode.window.activeTextEditor.document);
	}

	const timers = new Map<string, NodeJS.Timeout>();
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			const key = event.document.uri.toString();
			const old = timers.get(key);
			if (old) { clearTimeout(old); }
			timers.set(key, setTimeout(() => {
				timers.delete(key);
				runValidation(event.document);
			}, 250));
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) { runValidation(editor.document); }
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(doc => {
			const validator = pickValidator(doc);
			if (validator) { collections.get(validator.languageId)?.delete(doc.uri); }
		})
	);
}

export function deactivate() { }
