const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    description: {
      type: String,
      required: false,
      default: '',
      trim: true
    },
    imageUrl: {
      type: String,
      default: ''
    },
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    challengeType: {
      type: String,
      enum: ['habit', 'result'],
      default: 'habit'
    },
    frequency: {
      type: String,
      default: null,
      required: false,
      validate: {
        validator: function(v) {
          // Allow null/undefined for result challenges, or valid enum values for habit challenges
          return v === null || v === undefined || v === '' || ['daily', 'everyOtherDay'].includes(v);
        },
        message: '{VALUE} is not a valid frequency'
      }
    },
    actions: [
      {
        text: {
          type: String,
          default: ''
        },
        checked: {
          type: Boolean,
          default: false
        },
        children: {
          type: [
            {
              text: {
                type: String,
                default: ''
              },
              checked: {
                type: Boolean,
                default: false
              }
            }
          ],
          default: []
        }
      }
    ],
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    participants: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        completedDays: {
          type: [String],
          default: []
        }
      }
    ],
    allowComments: {
      type: Boolean,
      default: true
    },
    comments: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        text: {
          type: String,
          required: true,
          trim: true,
          maxlength: 1000
        },
        createdAt: {
          type: Date,
          default: Date.now
        },
        replies: [
          {
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              required: true
            },
            text: {
              type: String,
              required: true,
              trim: true,
              maxlength: 1000
            },
            mentionedUserId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              default: null
            },
            createdAt: {
              type: Date,
              default: Date.now
            },
            replies: [
              {
                userId: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: 'User',
                  required: true
                },
                text: {
                  type: String,
                  required: true,
                  trim: true,
                  maxlength: 1000
                },
                mentionedUserId: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: 'User',
                  default: null
                },
                createdAt: {
                  type: Date,
                  default: Date.now
                }
              }
            ]
          }
        ]
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Challenge', challengeSchema);
