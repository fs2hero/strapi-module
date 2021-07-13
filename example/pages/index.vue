<template>
  <div>
    <h1>@nuxtjs/strapi</h1>
    <h2>$strapi.state</h2>
    <pre>{{ JSON.stringify($strapi.state) }}</pre>
    <h2>options.url</h2>
    <h2>User</h2>
    <pre>{{ JSON.stringify(user) }}</pre>
    <pre>{{ JSON.stringify(error) }}</pre>
    <pre>{{ $strapi.$http._defaults.prefixUrl }}</pre>
  </div>
</template>

<script>
export default {
  async asyncData ({ $strapi }) {
    let user = null
    let error = null
    try {
      const res = await $strapi.login({ identifier: 'user2', password: '123456' })
      user = res.user
    } catch (err) {
      error = err
    }

    return { user, error }
  }
}
</script>

<style scoped>
div {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}
</style>
