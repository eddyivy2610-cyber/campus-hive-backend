import { Schema, model, Types, models } from "mongoose";

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
      required: false,
      select: false,
    },

    bio: { type:String, default:"Hey i am using Campus Market!"},
    avatar: { type: String, default:null }, // URL
    userName: { type:String, required:true, unique:true },

    personalDetails: {
      type: {
        fullName:{ type:String },
        dateOfBirth: { type: Date },
        stateOfOrigin: { type: String },
        phones: { 
          type:[String],
          default:[]
        }
      },
      default:null,
    },

    studentStatus:{
      type:{
        isStudent:{ type:Boolean, required:true },
        department:{ type:String, default:""},
      }
    },

    role: {
      type:{
        roleType:{
          type:String,
          enum:["seller", "buyer", "admin" ]
        },
        agreedToSellerPolicy:{ type:Boolean, default:true },
        businessName: { type:String, default:null },
        businessOffer: {
          type:String,
          enum:["electronics", "books", "fashion", "services", "hostel_items", "food_and_snacks", "other", "random"],
          default:null,
        },
        identification: {
          type:{
            idType:{
              type:String,
              enum:[ "student_id" , "other" ]
            },
            idImageUrl:{ type:String },
            isVerified:{ type:Boolean }
          },
          default:null
        }
      },
    },

    agreedToGeneralPolicy:{ type:Boolean },
    rating: { type: Number, default: 0 },

    accountStatus: {
        type: String,
        enum: [
            "active",
            "suspended", 
            "deleted", 
            "temporarily_deactivated", 
            "deactivated", 
            "banned", 
            "temp_data"
        ],
        default: "active",
    },

    lastLoginAt: { type: Date },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const User = models.User || model("User", UserSchema);
export default User;
