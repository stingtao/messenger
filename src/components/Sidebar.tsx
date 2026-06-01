import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User } from '../types';
import { LogOut, Search, User as UserIcon, UserPlus, Users, MessageCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../lib/api';

interface SidebarProps {
  selectedUser: User | null;
  onSelectUser: (user: User) => void;
}

export default function Sidebar({ selectedUser, onSelectUser }: SidebarProps) {
  const { user: currentUser, logout } = useAuth();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'friends' | 'search'>('friends');

  useEffect(() => {
    if (!currentUser) return;

    const loadUsers = async () => {
      const [usersResult, friendsResult] = await Promise.all([api.users(), api.friends()]);
      setAllUsers(usersResult.users);
      setFriendIds(new Set(friendsResult.friends.map((friend) => friend.uid)));
    };

    loadUsers().catch((error) => console.error('Error loading users:', error));
  }, [currentUser]);

  const handleAddFriend = async (e: React.MouseEvent, targetUid: string) => {
    e.stopPropagation();
    if (!currentUser) return;
    try {
      await api.addFriend(targetUid);
      setFriendIds((ids) => new Set(ids).add(targetUid));
    } catch (error) {
      console.error("Error adding friend:", error);
    }
  };

  const filteredUsers = allUsers.filter(u => 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const displayUsers = activeTab === 'friends' 
    ? filteredUsers.filter(u => friendIds.has(u.uid))
    : filteredUsers;

  return (
    <div className={cn(
      "w-full md:w-80 lg:w-96 bg-white border-r border-gray-200 flex flex-col h-full",
      selectedUser ? "hidden md:flex" : "flex"
    )}>
      {/* Header */}
      <div className="p-4 bg-[#202020] text-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          {currentUser?.photoURL ? (
            <img src={currentUser.photoURL} alt="Profile" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-500 flex items-center justify-center">
              <UserIcon className="w-6 h-6 text-white" />
            </div>
          )}
          <span className="font-semibold">{currentUser?.displayName}</span>
        </div>
        <button onClick={logout} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Logout">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('friends')}
          className={cn(
            "flex-1 py-3 flex items-center justify-center gap-2 font-medium transition-colors",
            activeTab === 'friends' ? "text-[#06C755] border-b-2 border-[#06C755]" : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Users className="w-5 h-5" />
          Friends
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={cn(
            "flex-1 py-3 flex items-center justify-center gap-2 font-medium transition-colors",
            activeTab === 'search' ? "text-[#06C755] border-b-2 border-[#06C755]" : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Search className="w-5 h-5" />
          Search
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={activeTab === 'friends' ? "Search friends..." : "Search by name or email..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-100 text-gray-800 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[#06C755]"
          />
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto">
        {displayUsers.map((user) => {
          const isFriend = friendIds.has(user.uid);
          return (
            <div
              key={user.uid}
              onClick={() => isFriend ? onSelectUser(user) : null}
              className={cn(
                "flex items-center gap-3 p-3 transition-colors",
                isFriend ? "cursor-pointer hover:bg-gray-50" : "cursor-default",
                selectedUser?.uid === user.uid && "bg-gray-100"
              )}
            >
              <div className="relative">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName} className="w-12 h-12 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                    <UserIcon className="w-6 h-6 text-gray-500" />
                  </div>
                )}
                {user.status === 'online' && (
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{user.displayName}</h3>
                <p className="text-sm text-gray-500 truncate">{user.email}</p>
              </div>
              
              {/* Action Button */}
              {activeTab === 'search' && !isFriend && (
                <button
                  onClick={(e) => handleAddFriend(e, user.uid)}
                  className="p-2 text-[#06C755] hover:bg-green-50 rounded-full transition-colors"
                  title="Add Friend"
                >
                  <UserPlus className="w-6 h-6" />
                </button>
              )}
              {activeTab === 'search' && isFriend && (
                <div className="p-2 text-gray-400" title="Already Friends">
                  <MessageCircle className="w-6 h-6" />
                </div>
              )}
            </div>
          );
        })}
        {displayUsers.length === 0 && (
          <div className="p-8 text-center text-gray-500 flex flex-col items-center gap-3">
            {activeTab === 'friends' ? (
              <>
                <Users className="w-12 h-12 text-gray-300" />
                <p>No friends found.</p>
                <button 
                  onClick={() => setActiveTab('search')}
                  className="text-[#06C755] font-medium hover:underline mt-2"
                >
                  Find friends
                </button>
              </>
            ) : (
              <>
                <Search className="w-12 h-12 text-gray-300" />
                <p>No users found matching your search.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
