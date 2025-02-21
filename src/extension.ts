import * as vscode from 'vscode';
import { format } from 'date-fns';
import { parseISO } from 'date-fns/parseISO';

interface Canteen {
    id: number;
    name: string;
}

interface Meal {
    id: number;
    name: string;
    category: string;
    prices: {
        students: number | null;
        employees: number | null;
        pupils: number | null;
        others: number | null;
    };
    notes: string[];
}

export async function activate(context: vscode.ExtensionContext) {

    const treeDataProvider = new OpenMensaTreeProvider(fetch);
    vscode.window.registerTreeDataProvider('openmensaTreeView', treeDataProvider);

    let changeCanteenCommand = vscode.commands.registerCommand('openmensa-vscode.changeCanteen', async () => {
        try {
            const newCanteenId = await selectCanteen(fetch);
            if (!newCanteenId) {
                vscode.window.showWarningMessage('No canteen selected.');
                return;
            }

            // Store new canteen ID in settings
            const config = vscode.workspace.getConfiguration('openmensa-vscode');
            await config.update('canteenId', newCanteenId, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage('Canteen changed successfully.');
            treeDataProvider.refresh(); // Refresh sidebar with new canteen's data
        } catch (error) {
            vscode.window.showErrorMessage(`Error changing canteen: ${error}`);
        }
    });

    async function getAvailableDates(): Promise<{ label: string, rawDate: string }[]> {
        const config = vscode.workspace.getConfiguration('openmensa-vscode');
        const canteenId = config.get<string>('canteenId', '');

        if (!canteenId) {
            vscode.window.showErrorMessage('No canteen selected.');
            return [];
        }
        try {
            const response = await fetch(`https://openmensa.org/api/v2/canteens/${canteenId}/days`);
            if (!response.ok) throw new Error('Failed to fetch dates');

            const days: { date: string, closed: boolean }[] = await response.json();

            return days
                .filter(day => !day.closed)
                .map(day => {
                    const parsed = parseISO(day.date);
                    return {
                        rawDate: day.date,
                        label: format(parsed, 'EEEE, dd MMM yyyy') // display only
                    };
                });
        } catch (error: unknown) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error fetching days: ${error.message}`);
            } else {
                vscode.window.showErrorMessage('An unknown error occurred while fetching days.');
            }
            return [];
        }
    }

    async function getCanteenName(canteenId: string): Promise<string> {
        const url = `https://openmensa.org/api/v2/canteens/${canteenId}`;
        console.log(`Fetching data from: ${url}`);
        const response = await fetch(url);

        // Debugging the response status and URL
        console.log(`API Response status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch meals: ${response.statusText}`);
        }

        const canteen = await response.json(); // contains `name`, `address`, etc.
        return canteen.name as string;
    }

    let disposable = vscode.commands.registerCommand('openmensa.fetchMenu', async () => {
        try {
            // Ask for the canteen ID
            const canteenId = await vscode.window.showInputBox({
                prompt: 'Enter the OpenMensa Canteen ID',
                placeHolder: 'e.g., 229'
            });
            if (!canteenId) {
                vscode.window.showWarningMessage('No canteen ID provided.');
                return;
            }
            // Ask for the date
            const date = await vscode.window.showInputBox({
                prompt: 'Enter the date (YYYY-MM-DD)',
                placeHolder: new Date().toISOString().split('T')[0]
            });
            const selectedDate = date || new Date().toISOString().split('T')[0];
            // Fetch data from OpenMensa API
            const url = `https://openmensa.org/api/v2/canteens/${canteenId}/days/${selectedDate}/meals`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch data: ${response.statusText}`);
            }
            const meals = await response.json();
            // Show an info message if no meals are found
            if (meals.length === 0) {
                vscode.window.showInformationMessage(`No meals found for ${selectedDate}.`);
                return;
            }
            // Format the data into a string
            const mealItems = (meals as Meal[]).map(meal => {
                return `**${meal.name}** (${meal.category})\n` +
                    `Prices: Students: ${meal.prices.students ?? 'N/A'}€, Employees: ${meal.prices.employees ?? 'N/A'}€\n` +
                    `Notes: ${meal.notes.length ? meal.notes.join(', ') : 'No additional notes'}\n\n`;
            }).join('');
            // Create a read-only text document to display the result
            const doc = await vscode.workspace.openTextDocument({ content: mealItems, language: 'markdown' });
            await vscode.window.showTextDocument(doc, { preview: false });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error fetching menu: ${error}`);
        }
    });

    let fetchMenuCommand = vscode.commands.registerCommand('openmensa-vscode.fetchMenuForDay', async (date: string) => {
        try {
            if (!date) {
                // Prompt the user to pick a date manually
                const items = await getAvailableDates();

                const picked = await vscode.window.showQuickPick(items.map(d => ({
                    label: d.label,
                    description: '',
                    rawDate: d.rawDate,
                })), {
                    placeHolder: 'Pick a day to view the menu'
                });

                if (!picked || !picked.rawDate) {
                    vscode.window.showErrorMessage('No date selected.');
                    return;
                }

                date = picked.rawDate;
            }

            const config = vscode.workspace.getConfiguration('openmensa-vscode');
            let canteenId = config.get<string>('canteenId', '');

            if (!canteenId) {
                vscode.window.showWarningMessage('No canteen selected.');
                return;
            }

            // Log the canteenId and the date for debugging purposes
            console.log(`Fetching meals for Canteen ID: ${canteenId}, Date: ${date}`);

            // Fetch meals for the selected day
            const url = `https://openmensa.org/api/v2/canteens/${canteenId}/days/${date}/meals`;
            console.log(`Fetching data from: ${url}`);
            const response = await fetch(url);

            // Debugging the response status and URL
            console.log(`API Response status: ${response.status}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch meals: ${response.statusText}`);
            }

            const meals = await response.json() as Meal[];

            if (meals.length === 0) {
                vscode.window.showInformationMessage(`No meals found for ${date}.`);
                return;
            }

            const parsedDate = parseISO(date); // `date` should be the raw API format, like "2025-04-14"
            const formattedDate = format(parsedDate, 'EEEE, dd MMM yyyy');

            const canteenName = await getCanteenName(canteenId);

            const formattedTitle = `Menu for ${formattedDate} - ${canteenName}`;


            // Open WebView with meal data
            const panel = vscode.window.createWebviewPanel(
                'openMensaMenu',
                formattedTitle,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = generateHTMLContent(meals, formattedTitle);

        } catch (error) {
            console.error("Error fetching menu:", error);
            vscode.window.showErrorMessage(`Error fetching menu: ${error}`);
        }
    });

    context.subscriptions.push(changeCanteenCommand, fetchMenuCommand);
}

class OpenMensaTreeProvider implements vscode.TreeDataProvider<OpenMensaTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    constructor(private fetch: any) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async getChildren(): Promise<OpenMensaTreeItem[]> {
        const config = vscode.workspace.getConfiguration('openmensa-vscode');
        let canteenId = config.get<string>('canteenId', '');

        if (!canteenId) {
            return [new OpenMensaTreeItem('No canteen selected', '', vscode.TreeItemCollapsibleState.None)];
        }

        try {
            // Fetch available days for the canteen
            const response = await this.fetch(`https://openmensa.org/api/v2/canteens/${canteenId}/days`);
            if (!response.ok) {
                throw new Error('Failed to fetch days.');
            }

            const days: { date: string, closed: boolean }[] = await response.json();

            return days
                .filter(day => !day.closed)
                .map(day => {
                    const parsed = parseISO(day.date);
                    const label = format(parsed, 'EEEE, dd MMM yyyy'); // e.g. "Monday, 14 Apr 2025"
                    return new OpenMensaTreeItem(label, day.date, vscode.TreeItemCollapsibleState.None);
                });

        } catch (error) {
            vscode.window.showErrorMessage(`Error fetching days: ${error}`);
            return [];
        }
    }

    getTreeItem(element: OpenMensaTreeItem): vscode.TreeItem {
        return element;
    }
}

class OpenMensaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly date: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.command = {
            command: 'openmensa-vscode.fetchMenuForDay',
            title: 'Open menu',
            arguments: [this.date]
        };
    }
}

// Function to allow users to search and select a canteen
async function selectCanteen(fetch: any): Promise<string | undefined> {
    try {
        let canteens: Canteen[] = [];
        let page = 1;

        // Fetch all canteens (pagination)
        while (true) {
            const response = await fetch(`https://openmensa.org/api/v2/canteens?page=${page}`);
            if (!response.ok) {
                throw new Error('Failed to fetch canteens.');
            }

            const data = await response.json() as Canteen[];

            if (data.length === 0) {
                break; // Stop when there are no more canteens
            }

            canteens = canteens.concat(data);
            page++;
        }

        const selected = await vscode.window.showQuickPick(
            canteens.map(canteen => ({
                label: canteen.name,
                description: `ID: ${canteen.id}`,
                id: canteen.id.toString()
            })),
            { placeHolder: 'Select a canteen' }
        );

        return selected?.id;
    } catch (error) {
        vscode.window.showErrorMessage(`Error fetching canteens: ${error}`);
        return undefined;
    }
}

function generateHTMLContent(meals: Meal[], formattedTitle: string): string {
    const mealCards = meals.map(meal => {
        const prices = meal.prices;
        return `
      <div class="card">
        <h3>${meal.name}</h3>
        <p><strong>Category:</strong> ${meal.category}</p>
        <p><strong>Students Price:</strong> ${prices.students ?? 'N/A'}</p>
        <p><strong>Employees Price:</strong> ${prices.employees ?? 'N/A'}</p>
        <p><strong>Pupils Price:</strong> ${prices.pupils ?? 'N/A'}</p>
        <p><strong>Others Price:</strong> ${prices.others ?? 'N/A'}</p>
        <p><strong>Notes:</strong> ${meal.notes.join(', ') || 'None'}</p>
      </div>
    `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenMensa Menu</title>
      <style>
        body {
          margin: 20pt;
        }
        h1 {
          margin-bottom: 20pt;
        }
        .card {
          border: 1pt solid var(--vscode-focusBorder);
          border-radius: 8pt;
          padding: 20pt;
          margin-bottom: 20pt;
          background-color: var(--vscode-button--background);
          box-shadow: 0 2pt 5pt var(--vscode-dropdown--border);
        }
        .card h3 {
          margin-top: 0;
        }
        .card p {
          margin: 5pt 0;
        }
        .card strong {
          color: var(--vscode-list--highlightForeground);
        }
      </style>
    </head>
    <body>
      <h1>${formattedTitle}</h1>
      <div id="meal-cards">
        ${mealCards}
      </div>
    </body>
    </html>
  `;
}

export function deactivate() { }