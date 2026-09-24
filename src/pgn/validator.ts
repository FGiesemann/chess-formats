import * as vscode from 'vscode';
import { LanguageValidator } from '../common/types';

class PgnValidator implements LanguageValidator {
    languageId = 'pgn';
    extensions = ['.pgn'];

    validate(doc: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        // TODO: PGN-Regeln (Tag-Pairs, Züge, Kommentare, ...)
        return diagnostics;
    }
}

export const pgnValidator: LanguageValidator = new PgnValidator();
