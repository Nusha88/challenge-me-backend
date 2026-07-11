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
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          auto: true
        },
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
              _id: {
                type: mongoose.Schema.Types.ObjectId,
                auto: true
              },
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
    resultMissionEndedAt: {
      type: Date,
      default: null
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'heroic'],
      default: 'medium'
    },
    reward: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500
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
        },
        frozenDays: {
          type: [String],
          default: []
        },
        secondChanceDays: {
          type: [String],
          default: []
        },
        joinedAt: {
          type: Date,
          default: null
        },
        habitMissionEndedAt: {
          type: Date,
          default: null
        },
        completionTier: {
          type: String,
          enum: ['perfect', 'bright', 'sustained', 'extinguished', null],
          default: null
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
          default: '',
          trim: true,
          maxlength: 1000
        },
        imageUrl: {
          type: String,
          default: null
        },
        isTriumph: {
          type: Boolean,
          default: false
        },
        actionTitle: {
          type: String,
          default: '',
          trim: true
        },
        reactions: {
          type: Map,
          of: [{
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User'
            }
          }],
          default: {}
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
            imageUrl: {
              type: String,
              default: null
            },
            mentionedUserId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              default: null
            },
            reactions: {
              type: Map,
              of: [{
                userId: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: 'User'
                }
              }],
              default: {}
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
                imageUrl: {
                  type: String,
                  default: null
                },
                mentionedUserId: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: 'User',
                  default: null
                },
                reactions: {
                  type: Map,
                  of: [{
                    userId: {
                      type: mongoose.Schema.Types.ObjectId,
                      ref: 'User'
                    }
                  }],
                  default: {}
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
    ],
    userDiaryEntries: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        text: {
          type: String,
          default: '',
          trim: true,
          maxlength: 1000
        },
        imageUrl: {
          type: String,
          default: null
        },
        actionTitle: {
          type: String,
          default: ''
        },
        actionId: {
          type: mongoose.Schema.Types.ObjectId
        },
        isTriumph: {
          type: Boolean,
          default: false
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes to back the common query/filter patterns and avoid full collection
// scans (challenge listing, per-user lookups, scheduler habit queries).
challengeSchema.index({ createdAt: -1 });
challengeSchema.index({ privacy: 1, createdAt: -1 });
challengeSchema.index({ owner: 1, createdAt: -1 });
challengeSchema.index({ challengeType: 1, privacy: 1 });
challengeSchema.index({ 'participants.userId': 1 });
challengeSchema.index({ challengeType: 1, 'participants.userId': 1 });
challengeSchema.index({ startDate: 1 });
challengeSchema.index({ endDate: 1 });

module.exports = mongoose.model('Challenge', challengeSchema);
