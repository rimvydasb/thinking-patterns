import type {Outline} from './model/types';

/** The example from docs/img.png. */
export const softwareFactory: Outline = {
    text: 'Software Factory',
    children: [
        {text: 'Loops', children: [{text: 'Forward Pressure'}, {text: 'Backward pressure'}]},
        {
            text: 'Software Quality Attributes',
            children: [
                {text: 'Availability'},
                {text: 'Reliability'},
                {text: 'Performance', children: [{text: 'k6'}]},
                {text: 'Scalability'},
                {text: 'Security'},
                {text: 'Maintainability', children: [{text: 'dependency cycle'}]},
                {text: 'Observability'},
            ],
        },
        {text: 'Formal Verification For Each software attribute'},
        {text: 'Events'},
    ],
};

export const productLaunch: Outline = {
    text: 'Product Launch',
    children: [
        {text: 'Goals', children: [{text: '10k sign-ups'}, {text: 'Press coverage'}]},
        {text: 'Audience', children: [{text: 'Indie developers'}, {text: 'Small teams'}]},
        {text: 'Channels', children: [{text: 'Blog'}, {text: 'Newsletter'}, {text: 'Social'}]},
        {text: 'Timeline', children: [{text: 'Beta – March'}, {text: 'GA – May'}]},
        {text: 'Risks', children: [{text: 'Scope creep'}, {text: 'Infra cost'}]},
        {text: 'Budget'},
    ],
};

export const organisation: Outline = {
    text: 'CEO',
    children: [
        {text: 'CTO', children: [{text: 'Platform'}, {text: 'Product Eng'}, {text: 'QA'}]},
        {text: 'CFO', children: [{text: 'Accounting'}, {text: 'Legal'}]},
        {text: 'COO', children: [{text: 'Support'}, {text: 'Sales'}]},
    ],
};

export const thinkingPatterns: Outline = {
    text: 'Thinking Patterns',
    children: [
        {
            text: 'Analysis',
            children: [
                {text: 'First principles', children: [{text: 'Question assumptions'}, {text: 'Rebuild from facts'}]},
                {text: 'Inversion'},
                {text: 'Second-order effects'},
            ],
        },
        {
            text: 'Decision making',
            collapsed: true,
            children: [{text: 'Reversible vs irreversible'}, {text: 'Expected value'}, {text: 'Regret minimisation'}],
        },
        {
            text: 'Systems',
            children: [
                {text: 'Feedback loops', collapsed: true, children: [{text: 'Reinforcing'}, {text: 'Balancing'}]},
                {text: 'Bottlenecks'},
                {text: 'Leverage points'},
            ],
        },
        {text: 'Creativity', children: [{text: 'Lateral thinking'}, {text: 'Constraints'}]},
    ],
};

export const SAMPLES: Record<string, Outline> = {
    'software-factory': softwareFactory,
    'product-launch': productLaunch,
    organisation,
    'thinking-patterns': thinkingPatterns,
};
