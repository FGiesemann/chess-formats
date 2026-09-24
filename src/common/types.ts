import * as vscode from 'vscode';

export interface LanguageValidator {
    languageId: string;
    extensions: string[];

    /**
     * Checks the document and returns the found diagnostics.
     * The caller is responsible for setting the diagnostics in a diagnostic collection.
     */
    validate(document: vscode.TextDocument): vscode.Diagnostic[];
}
