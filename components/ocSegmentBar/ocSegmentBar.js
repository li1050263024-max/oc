Component({
  properties: {
    current: { type: String, value: '' },
    options: {
      type: Array,
      value: []
    }
  },

  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      if (!key || key === this.properties.current) return;
      this.triggerEvent('change', { key });
    }
  }
});
