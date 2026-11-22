/** The card of task `id`, each text scanned under the field `card.<part>`, an option as `card.options`. */
export function servedCard(served, id, card) {
    return {
        question: served.plain(id, 'card.question', card.question),
        options: card.options.map((option) => served.plain(id, 'card.options', option)),
        recommend: served.plain(id, 'card.recommend', card.recommend),
        byDefault: served.plain(id, 'card.byDefault', card.byDefault),
        whyAsk: served.plainOrNull(id, 'card.whyAsk', card.whyAsk ?? null),
        gate: served.plainOrNull(id, 'card.gate', card.gate ?? null),
        run: served.plainOrNull(id, 'card.run', card.run ?? null),
        affects: served.plainOrNull(id, 'card.affects', card.affects ?? null),
        security: card.security === true,
    };
}
