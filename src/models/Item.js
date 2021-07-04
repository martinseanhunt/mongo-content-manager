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
    contentType: {
      type: String,
      enum: ['multi', 'graphic', 'link', 'video', 'podcast'],
      required: true,
    },
    tags: {
      type: Array,
      required: true,
    },
    image: {
      type: String,
      required: false,
    },
    imageText: {
      type: String,
      required: false,
    },
    url: {
      type: String,
      required: false,
    },
    bodyContent: {
      type: String,
      required: false,
    },
    strippedContent: {
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
