// Ver wrangler.jsonc ao lado: este Worker é o subproduto do portão de CI.
export default {
    fetch() {
        return new Response('odontobox-ci: o valor deste Worker é o build que o precede (scripts/ci-worker.mjs)')
    },
}
