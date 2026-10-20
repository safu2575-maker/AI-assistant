import { Model } from './model.js';
export function guidedCard(model: Model) {
  const choices = (items: { name: string }[]) => items.map(x => ({ title: x.name, value: x.name }));
  return {
    type: 'AdaptiveCard', version: '1.5',
    body: [
      { type: 'TextBlock', text: 'Ask with suggestions', weight: 'Bolder', size: 'Large' },
      { type: 'TextBlock', text: 'Choose your measure and breakdown. Optionally search a filter value. Values follow your Power BI permissions.', wrap: true },
      { type: 'Input.ChoiceSet', id: 'measure', label: 'Measure', style: 'filtered', isRequired: true, errorMessage: 'Select a measure', choices: choices(model.measures), value: model.measures[0].name },
      { type: 'Input.ChoiceSet', id: 'dimension', label: 'Break down by', choices: [{ title: 'Total (no breakdown)', value: '' }, ...choices(model.dimensions)] },
      ...(model.year ? [{ type: 'Input.Text', id: 'year', label: 'Year (optional)', placeholder: 'For example, 2025', maxLength: 4 }] : []),
      { type: 'Input.ChoiceSet', id: 'filterField', label: 'Filter field (optional)', choices: [{ title: 'No filter', value: '' }, ...choices(model.dimensions)], valueChangedAction: { type: 'Action.ResetInputs', targetInputIds: ['filterValue'] } },
      { type: 'Input.ChoiceSet', id: 'filterValue', label: 'Filter value', style: 'filtered', placeholder: 'Select a field above, then type to search', 'choices.data': { type: 'Data.Query', dataset: `model-values:${model.datasetId}`, associatedInputs: 'auto' } }
    ],
    actions: [{ type: 'Action.Submit', title: 'Ask', data: { action: 'guidedAsk', datasetId: model.datasetId } }]
  };
}
