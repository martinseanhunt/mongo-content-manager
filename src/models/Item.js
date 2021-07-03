const mongoose = require('mongoose')

const itemSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      unique: true,
    },
    title: {
      type: String,
      required: true,
    },
    image_filename: {
      type: String,
      required: true,
    },
    image_text: {
      type: String,
      required: true,
    },
    tags: {
      type: Array,
      required: false,
    },
    body_content: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
)

const Item = mongoose.model('Item', itemSchema)

module.exports = { Item }
